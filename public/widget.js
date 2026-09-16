(function () {
  "use strict";

  var script =
    document.currentScript ||
    (function () {
      var all = document.getElementsByTagName("script");
      for (var i = all.length - 1; i >= 0; i -= 1) {
        if (all[i].hasAttribute("data-widget-key")) return all[i];
      }
      return null;
    })();

  if (!script) return;

  var WIDGET_KEY = script.getAttribute("data-widget-key");
  if (!WIDGET_KEY) return;

  var API_BASE = (
    script.getAttribute("data-api") ||
    (function () {
      try {
        return new URL(script.src, window.location.href).origin;
      } catch (error) {
        return "";
      }
    })()
  ).replace(/\/$/, "");

  var BASE = API_BASE + "/api/public/website-widget/" + encodeURIComponent(WIDGET_KEY);
  var STORAGE_KEY = "itstime-widget:" + WIDGET_KEY;

  var DEFAULT_FOOTER_LOGO = "/widget-assets/itstime-mark.png";
  var DEFAULT_FOOTER_BRAND = "Its Time";
  var DEFAULT_FOOTER_URL = "https://itstime.pro";

  var POLL_ACTIVE_MS = 2000;
  var POLL_IDLE_MS = 6000;
  var POLL_MAX_BACKOFF_MS = 15000;

  var AREA_CODES = {};
  "11,12,13,14,15,16,17,18,19,21,22,24,27,28,31,32,33,34,35,37,38,41,42,43,44,45,46,47,48,49,51,53,54,55,61,62,63,64,65,66,67,68,69,71,73,74,75,77,79,81,82,83,84,85,86,87,88,89,91,92,93,94,95,96,97,98,99"
    .split(",")
    .forEach(function (code) {
      AREA_CODES[code] = true;
    });

  var state = {
    open: false,
    started: false,
    sessionToken: null,
    cursor: null,
    messages: [],
    awaitingReply: false,
    offline: false,
    pollTimer: null,
    pollBackoff: POLL_ACTIVE_MS,
    config: { welcomeMessage: "Oi! Como posso ajudar?", theme: {} },
  };

  // ------------------------------------------------------------- persistence

  function loadStored() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (error) {
      return null;
    }
  }

  function saveStored(value) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch (error) {
      /* private mode or blocked storage: the chat still works for this page */
    }
  }

  // Keeping the thread next to the token so a reload does not look like the
  // conversation was lost: the cursor alone would only return newer messages.
  function persistSession() {
    saveStored({
      sessionToken: state.sessionToken,
      cursor: state.cursor,
      messages: state.messages.slice(-50),
    });
  }

  function clearStored() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      /* nothing to do */
    }
  }

  // -------------------------------------------------------------- validation

  function validateName(value) {
    var name = String(value || "").replace(/\s+/g, " ").trim();
    if (!name) return { ok: false, message: "Informe seu nome." };
    if (name.length < 2 || name.length > 120) {
      return { ok: false, message: "Informe seu nome completo." };
    }
    if (!/[A-Za-zÀ-ÿ]/.test(name)) return { ok: false, message: "Informe seu nome." };
    return { ok: true, value: name };
  }

  function validatePhone(value) {
    var raw = String(value || "").trim();
    var invalid = { ok: false, message: "Informe um telefone brasileiro com DDD." };
    if (!raw) return { ok: false, message: "Informe seu telefone." };

    var digits = raw.replace(/\D/g, "");
    if ((raw.charAt(0) === "+" || raw.slice(0, 2) === "00") && digits.slice(0, 2) !== "55") {
      return invalid;
    }
    if (digits.slice(0, 2) === "55" && (digits.length === 12 || digits.length === 13)) {
      digits = digits.slice(2);
    }
    if (digits.length !== 10 && digits.length !== 11) return invalid;
    if (!AREA_CODES[digits.slice(0, 2)]) return invalid;

    var subscriber = digits.slice(2);
    if (subscriber.length === 9) {
      return subscriber.charAt(0) === "9" ? { ok: true, value: digits } : invalid;
    }
    if (/^[2-5]/.test(subscriber)) return { ok: true, value: digits };
    if (/^[6-9]/.test(subscriber)) {
      return { ok: true, value: digits.slice(0, 2) + "9" + subscriber };
    }
    return invalid;
  }

  // --------------------------------------------------------------------- api

  function request(path, options) {
    var settings = options || {};
    return fetch(BASE + path, {
      method: settings.method || "GET",
      headers: settings.body ? { "Content-Type": "application/json" } : undefined,
      body: settings.body ? JSON.stringify(settings.body) : undefined,
    }).then(function (response) {
      return response
        .json()
        .catch(function () {
          return {};
        })
        .then(function (data) {
          if (!response.ok) {
            var error = new Error(data.error || "Falha na comunicacao");
            error.status = response.status;
            error.code = (data.details && data.details.code) || data.code;
            throw error;
          }
          return data;
        });
    });
  }

  // ---------------------------------------------------------------- rendering

  var root;
  var refs = {};

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function agentName() {
    return state.config.theme.agentName || state.config.theme.title || "Atendimento";
  }

  /** Lets a connection store "/widget-assets/x.png" and still work on any host. */
  function assetUrl(value) {
    if (!value) return null;
    if (/^https?:\/\//i.test(value)) return value;
    var origin = API_BASE;
    try {
      origin = new URL(script.src, window.location.href).origin;
    } catch (error) {
      /* keep the API origin as the fallback */
    }
    return origin.replace(/\/$/, "") + (value.charAt(0) === "/" ? value : "/" + value);
  }

  function avatarNode(size) {
    var wrapper = element("span", "avatar avatar-" + size);
    var url = assetUrl(state.config.theme.avatarUrl);
    if (url) {
      var img = document.createElement("img");
      img.src = url;
      img.alt = "";
      img.addEventListener("error", function () {
        if (img.parentNode === wrapper) wrapper.removeChild(img);
        wrapper.textContent = agentName().charAt(0).toUpperCase();
      });
      wrapper.appendChild(img);
    } else {
      wrapper.textContent = agentName().charAt(0).toUpperCase();
    }
    return wrapper;
  }

  function buildFooter() {
    var theme = state.config.theme;
    var label = theme.footerText;
    if (!label) return null;

    var footer = element("footer", "footer");
    var content = element("span", "brand");
    content.appendChild(element("span", null, label));

    var logo = assetUrl(theme.footerLogoUrl || DEFAULT_FOOTER_LOGO);
    if (logo) {
      var img = document.createElement("img");
      img.className = "brand-logo";
      img.src = logo;
      img.alt = "";
      img.addEventListener("error", function () {
        if (img.parentNode) img.parentNode.removeChild(img);
      });
      content.appendChild(img);
    }

    var brand =
      theme.footerBrand === undefined ? DEFAULT_FOOTER_BRAND : theme.footerBrand;
    if (brand) content.appendChild(element("span", "brand-name", brand));

    var href = theme.footerUrl === undefined ? DEFAULT_FOOTER_URL : theme.footerUrl;
    // http(s) only. The widget runs inside other people's pages, so a
    // "javascript:" address coming from configuration must never become a link.
    if (href && /^https?:\/\//i.test(href)) {
      var link = document.createElement("a");
      link.className = "brand-link";
      link.href = href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.appendChild(content);
      footer.appendChild(link);
    } else {
      footer.appendChild(content);
    }

    return footer;
  }

  function build() {
    var host = document.createElement("div");
    host.setAttribute("data-itstime-widget", "");
    document.body.appendChild(host);
    root = host.attachShadow({ mode: "open" });

    var style = document.createElement("style");
    style.textContent = STYLES;
    root.appendChild(style);

    root.host.style.setProperty("--iw-accent", state.config.theme.color || "#12b5a5");

    refs.launcher = element("button", "launcher");
    refs.launcher.setAttribute("type", "button");
    refs.launcher.setAttribute("aria-label", "Abrir conversa");
    refs.launcher.innerHTML =
      '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="M12 3c5 0 9 3.36 9 7.5s-4 7.5-9 7.5c-.9 0-1.77-.11-2.58-.31L5 20l1.2-3.2C4.23 15.45 3 13.1 3 10.5 3 6.36 7 3 12 3z"/></svg>';
    refs.launcher.addEventListener("click", toggle);
    root.appendChild(refs.launcher);

    refs.panel = element("section", "panel");
    refs.panel.setAttribute("role", "dialog");
    refs.panel.setAttribute("aria-label", "Conversa");
    refs.panel.hidden = true;

    var header = element("header", "header");
    header.appendChild(avatarNode("lg"));

    var identity = element("div", "identity");
    identity.appendChild(element("span", "name", agentName()));
    var presence = element("span", "presence");
    presence.appendChild(element("i", "dot"));
    presence.appendChild(
      element("span", null, state.config.theme.statusLabel || "Online"),
    );
    identity.appendChild(presence);
    header.appendChild(identity);

    var close = element("button", "close");
    close.setAttribute("type", "button");
    close.setAttribute("aria-label", "Fechar conversa");
    close.innerHTML =
      '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">' +
      '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/></svg>';
    close.addEventListener("click", toggle);
    header.appendChild(close);
    refs.panel.appendChild(header);

    refs.body = element("div", "body");
    refs.panel.appendChild(refs.body);

    var footer = buildFooter();
    if (footer) refs.panel.appendChild(footer);

    root.appendChild(refs.panel);
  }

  function renderForm(notice) {
    refs.body.innerHTML = "";

    var greeting = element("div", "list");
    appendBubbleTo(greeting, state.config.welcomeMessage, true);
    refs.body.appendChild(greeting);

    if (notice) refs.body.appendChild(element("p", "notice", notice));

    var form = element("form", "form");
    var nameField = element("label", "field");
    nameField.appendChild(element("span", null, "Nome"));
    var nameInput = element("input");
    nameInput.type = "text";
    nameInput.autocomplete = "name";
    nameField.appendChild(nameInput);
    form.appendChild(nameField);

    var phoneField = element("label", "field");
    phoneField.appendChild(element("span", null, "Telefone com DDD"));
    var phoneInput = element("input");
    phoneInput.type = "tel";
    phoneInput.autocomplete = "tel";
    phoneInput.placeholder = "(11) 99999-9999";
    phoneField.appendChild(phoneInput);
    form.appendChild(phoneField);

    var error = element("p", "error");
    error.hidden = true;
    form.appendChild(error);

    var submit = element("button", "submit", "Começar conversa");
    submit.type = "submit";
    form.appendChild(submit);

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var name = validateName(nameInput.value);
      if (!name.ok) return showError(error, name.message);
      var phone = validatePhone(phoneInput.value);
      if (!phone.ok) return showError(error, phone.message);

      error.hidden = true;
      submit.disabled = true;
      submit.textContent = "Abrindo...";

      request("/sessions", { method: "POST", body: { name: name.value, phone: phone.value } })
        .then(function (data) {
          state.sessionToken = data.sessionToken;
          state.cursor = data.cursor;
          state.started = true;
          state.messages = [];
          persistSession();
          renderChat();
          schedulePoll(POLL_IDLE_MS);
        })
        .catch(function (err) {
          submit.disabled = false;
          submit.textContent = "Começar conversa";
          showError(error, err.message || "Nao foi possivel abrir a conversa.");
        });
    });

    refs.body.appendChild(form);
    nameInput.focus();
  }

  function showError(node, message) {
    node.textContent = message;
    node.hidden = false;
  }

  function renderChat() {
    refs.body.innerHTML = "";

    refs.list = element("div", "list");
    refs.body.appendChild(refs.list);

    refs.status = element("p", "status");
    refs.status.hidden = true;
    refs.body.appendChild(refs.status);

    var composer = element("form", "composer");
    refs.input = element("input");
    refs.input.type = "text";
    refs.input.placeholder = "Digite sua mensagem...";
    refs.input.setAttribute("aria-label", "Mensagem");
    composer.appendChild(refs.input);

    var send = element("button", "send");
    send.type = "submit";
    send.setAttribute("aria-label", "Enviar mensagem");
    send.innerHTML =
      '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">' +
      '<path fill="currentColor" d="M3.4 20.4l17.45-7.48a1 1 0 000-1.84L3.4 3.6a1 1 0 00-1.39 1.1L4 11l9 1-9 1-1.99 6.3a1 1 0 001.39 1.1z"/></svg>';
    composer.appendChild(send);

    composer.addEventListener("submit", function (event) {
      event.preventDefault();
      var text = refs.input.value.trim();
      if (!text) return;
      refs.input.value = "";
      pushMessage({ direction: "inbound", content: text, local: true });
      state.awaitingReply = true;
      renderStatus();

      request("/messages", {
        method: "POST",
        body: { sessionToken: state.sessionToken, text: text },
      })
        .then(function () {
          schedulePoll(POLL_ACTIVE_MS);
        })
        .catch(handleRequestError);
    });

    refs.body.appendChild(composer);
    renderMessages();
    refs.input.focus();
  }

  function pushMessage(message) {
    state.messages.push(message);
    renderMessages();
  }

  function appendBubbleTo(container, content, fromAgent) {
    var row = element("div", "row " + (fromAgent ? "from-them" : "from-me"));
    if (fromAgent) row.appendChild(avatarNode("sm"));
    row.appendChild(element("div", "bubble " + (fromAgent ? "them" : "me"), content));
    container.appendChild(row);
  }

  function renderMessages() {
    if (!refs.list) return;
    refs.list.innerHTML = "";

    // Keep the greeting visible once the form is gone, so the visitor never
    // faces an empty chat wondering whether it worked.
    if (state.messages.length === 0) {
      appendBubbleTo(refs.list, state.config.welcomeMessage, true);
    }

    state.messages.forEach(function (message) {
      appendBubbleTo(refs.list, message.content, message.direction === "outbound");
    });
    refs.list.scrollTop = refs.list.scrollHeight;
  }

  function renderStatus() {
    if (!refs.status) return;
    if (state.offline) {
      refs.status.textContent = "Reconectando...";
      refs.status.hidden = false;
      return;
    }
    if (state.awaitingReply) {
      refs.status.textContent = "Digitando...";
      refs.status.hidden = false;
      return;
    }
    refs.status.hidden = true;
  }

  // ------------------------------------------------------------------ polling

  function schedulePoll(delay) {
    if (state.pollTimer) window.clearTimeout(state.pollTimer);
    state.pollTimer = window.setTimeout(poll, delay);
  }

  /**
   * The visitor must never be left without an answer, so this loop never gives
   * up: network failures only slow it down, they never end the conversation.
   */
  function poll() {
    if (!state.sessionToken) return;

    var query =
      "?sessionToken=" +
      encodeURIComponent(state.sessionToken) +
      (state.cursor ? "&cursor=" + encodeURIComponent(state.cursor) : "");

    request("/messages" + query)
      .then(function (data) {
        state.offline = false;
        state.pollBackoff = POLL_ACTIVE_MS;

        var incoming = data.messages || [];
        if (incoming.length > 0) {
          state.messages = state.messages.filter(function (message) {
            return !message.local;
          });
          incoming.forEach(function (message) {
            state.messages.push(message);
          });
          renderMessages();
        }

        state.cursor = data.cursor || state.cursor;
        state.awaitingReply = Boolean(data.awaitingReply);
        persistSession();
        renderStatus();
        schedulePoll(state.awaitingReply ? POLL_ACTIVE_MS : POLL_IDLE_MS);
      })
      .catch(handleRequestError);
  }

  function handleRequestError(error) {
    if (error && error.status === 410) {
      // Only an expired session resets the widget; everything else retries.
      clearStored();
      state.sessionToken = null;
      state.started = false;
      state.messages = [];
      renderForm("Sua conversa anterior expirou. Comece de novo e continuamos daqui.");
      return;
    }

    state.offline = true;
    renderStatus();
    state.pollBackoff = Math.min(state.pollBackoff * 2, POLL_MAX_BACKOFF_MS);
    schedulePoll(state.pollBackoff);
  }

  // ------------------------------------------------------------------ control

  function toggle() {
    state.open = !state.open;
    refs.panel.hidden = !state.open;
    refs.launcher.classList.toggle("open", state.open);
    if (state.open && state.started) {
      schedulePoll(POLL_ACTIVE_MS);
      if (refs.input) refs.input.focus();
    }
  }

  function start() {
    request("/config")
      .then(function (data) {
        state.config = {
          welcomeMessage: data.welcomeMessage || state.config.welcomeMessage,
          theme: data.theme || {},
        };
        build();

        var stored = loadStored();
        if (stored && stored.sessionToken) {
          state.sessionToken = stored.sessionToken;
          state.cursor = stored.cursor || null;
          state.messages = Array.isArray(stored.messages) ? stored.messages : [];
          state.started = true;
          renderChat();
          schedulePoll(POLL_ACTIVE_MS);
        } else {
          renderForm(null);
        }
      })
      .catch(function () {
        /* A misconfigured or paused widget stays invisible to the visitor. */
      });
  }

  var STYLES = [
    ":host{all:initial;}",
    "*{box-sizing:border-box;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;}",
    ".launcher{position:fixed;right:24px;bottom:24px;width:58px;height:58px;border-radius:50%;border:0;background:var(--iw-accent);color:#fff;cursor:pointer;box-shadow:0 10px 30px rgba(16,24,40,.22);display:flex;align-items:center;justify-content:center;z-index:2147483000;transition:transform .15s ease;}",
    ".launcher:hover{transform:translateY(-2px);}",
    ".launcher.open{transform:scale(.9);}",
    ".panel[hidden]{display:none;}",
    ".panel{position:fixed;right:24px;bottom:96px;width:380px;max-width:calc(100vw - 32px);height:560px;max-height:calc(100vh - 130px);background:#fff;border:1px solid rgba(16,24,40,.06);border-radius:18px;box-shadow:0 24px 60px rgba(16,24,40,.18);display:flex;flex-direction:column;overflow:hidden;z-index:2147483000;}",
    ".header{display:flex;align-items:center;gap:12px;padding:16px 18px;border-bottom:1px solid #eef1f4;background:#fff;}",
    ".identity{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;}",
    ".name{font-size:16px;font-weight:700;color:#101828;line-height:1.2;}",
    ".presence{display:flex;align-items:center;gap:6px;font-size:12px;color:#667085;}",
    ".dot{width:7px;height:7px;border-radius:50%;background:var(--iw-accent);display:inline-block;}",
    ".close{background:transparent;border:0;color:#98a2b3;cursor:pointer;padding:4px;display:flex;border-radius:8px;}",
    ".close:hover{color:#475467;background:#f2f4f7;}",
    ".avatar{display:flex;align-items:center;justify-content:center;border-radius:50%;overflow:hidden;background:#f2f4f7;color:var(--iw-accent);font-weight:700;flex:none;}",
    ".avatar img{width:100%;height:100%;object-fit:cover;display:block;}",
    ".avatar-lg{width:44px;height:44px;font-size:17px;box-shadow:0 0 0 2px var(--iw-accent);}",
    ".avatar-sm{width:30px;height:30px;font-size:12px;}",
    ".body{flex:1;display:flex;flex-direction:column;min-height:0;overflow:hidden;}",
    ".list{flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:12px;padding:18px;}",
    ".row{display:flex;align-items:flex-end;gap:8px;}",
    ".row.from-me{justify-content:flex-end;}",
    ".bubble{max-width:78%;padding:11px 14px;font-size:14px;line-height:1.5;white-space:pre-wrap;word-break:break-word;border-radius:18px;}",
    ".bubble.them{background:#f2f4f7;color:#1d2939;border-bottom-left-radius:6px;}",
    ".bubble.me{background:var(--iw-accent);color:#fff;border-bottom-right-radius:6px;}",
    ".status{margin:0;padding:0 18px 8px;font-size:12px;color:#98a2b3;}",
    ".composer{display:flex;align-items:center;gap:10px;padding:14px 18px;border-top:1px solid #eef1f4;}",
    ".composer input{flex:1;min-width:0;padding:12px 16px;border:1px solid #e4e7ec;border-radius:999px;font-size:14px;color:#1d2939;background:#fafafa;}",
    ".composer input:focus{outline:none;border-color:var(--iw-accent);background:#fff;}",
    ".send{width:42px;height:42px;flex:none;border:0;border-radius:50%;background:var(--iw-accent);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;}",
    ".send:hover{filter:brightness(1.06);}",
    ".footer{padding:9px 10px;text-align:center;border-top:1px solid #f2f4f7;}",
    ".brand{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:#98a2b3;line-height:1;}",
    ".brand-logo{width:15px;height:15px;object-fit:contain;display:block;}",
    ".brand-name{font-weight:600;color:#667085;}",
    ".brand-link{display:inline-flex;text-decoration:none;}",
    ".brand-link:hover .brand-name{color:var(--iw-accent);}",
    ".notice{margin:0 18px 12px;font-size:13px;color:#93370d;background:#fffaeb;padding:10px 12px;border-radius:10px;}",
    ".form{display:flex;flex-direction:column;gap:12px;padding:0 18px 18px;}",
    ".field{display:flex;flex-direction:column;gap:6px;font-size:13px;color:#475467;}",
    ".field input{padding:12px 14px;border:1px solid #e4e7ec;border-radius:12px;font-size:14px;color:#1d2939;background:#fafafa;}",
    ".field input:focus{outline:none;border-color:var(--iw-accent);background:#fff;}",
    ".error{margin:0;font-size:13px;color:#d92d20;}",
    ".submit{background:var(--iw-accent);color:#fff;border:0;border-radius:999px;padding:12px 16px;font-size:14px;font-weight:600;cursor:pointer;}",
    ".submit[disabled]{opacity:.65;cursor:default;}",
    "@media (max-width:440px){.panel{right:10px;left:10px;width:auto;bottom:90px;}}",
  ].join("");

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
