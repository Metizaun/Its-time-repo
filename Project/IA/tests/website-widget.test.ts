import assert from "node:assert/strict";
import test from "node:test";

import {
  isOriginAllowed,
  normalizeDomain,
  validateBrazilianPhone,
  validateVisitorName,
} from "../website-widget-validation.js";
import { embedSnippetFor, parseAllowedDomains } from "../website-widget-service.js";

test("normaliza o nome do visitante e recusa preenchimento sem letra", () => {
  const valid = validateVisitorName("  Maria   Silva  ");
  assert.equal(valid.ok, true);
  assert.equal(valid.ok && valid.value, "Maria Silva");

  for (const invalid of ["", "   ", "M", "12345", "..."]) {
    const result = validateVisitorName(invalid);
    assert.equal(result.ok, false, `deveria recusar ${JSON.stringify(invalid)}`);
    assert.equal(result.ok === false && result.error.field, "name");
  }
});

test("aceita telefone brasileiro em qualquer formatacao e devolve o nacional", () => {
  const cases: Array<[string, string]> = [
    ["+55 (11) 99999-9999", "11999999999"],
    ["5511999999999", "11999999999"],
    ["11999999999", "11999999999"],
    ["(41) 3333-4444", "4133334444"],
  ];

  for (const [input, expected] of cases) {
    const result = validateBrazilianPhone(input);
    assert.equal(result.ok, true, `deveria aceitar ${input}`);
    assert.equal(result.ok && result.value, expected);
  }
});

test("completa o nono digito de celular informado com dez digitos", () => {
  const result = validateBrazilianPhone("11 8888-7777");
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.value, "11988887777");
});

test("recusa telefone estrangeiro, DDD inexistente e tamanho invalido", () => {
  for (const invalid of ["", "+1 415 555 2671", "(00) 99999-9999", "999999999", "1199999999999"]) {
    const result = validateBrazilianPhone(invalid);
    assert.equal(result.ok, false, `deveria recusar ${JSON.stringify(invalid)}`);
    assert.equal(result.ok === false && result.error.field, "phone");
  }
});

test("recusa celular de onze digitos que nao comeca com nove", () => {
  const result = validateBrazilianPhone("11888887777");
  assert.equal(result.ok, false);
});

test("normaliza dominio informado com protocolo, porta ou caminho", () => {
  assert.equal(normalizeDomain("https://Arquem.com.br/contato"), "arquem.com.br");
  assert.equal(normalizeDomain("arquem.com.br:8080"), "arquem.com.br");
  assert.equal(normalizeDomain("http://localhost:3000"), "localhost");
  assert.equal(normalizeDomain("maquina-local"), null);
  assert.equal(normalizeDomain(""), null);
});

test("autoriza apenas a origem cadastrada e seus subdominios", () => {
  const allowed = ["arquem.com.br"];

  assert.equal(isOriginAllowed("https://arquem.com.br", allowed), true);
  assert.equal(isOriginAllowed("https://www.arquem.com.br", allowed), true);
  assert.equal(isOriginAllowed("https://loja.arquem.com.br", allowed), true);

  assert.equal(isOriginAllowed("https://arquem.com.br.evil.com", allowed), false);
  assert.equal(isOriginAllowed("https://naoarquem.com.br", allowed), false);
  assert.equal(isOriginAllowed("", allowed), false);
  assert.equal(isOriginAllowed("https://arquem.com.br", []), false);
});

test("normaliza a lista de sites autorizados e recusa entrada invalida", () => {
  assert.deepEqual(
    parseAllowedDomains("https://Arquem.com.br/contato, www.arquem.com.br\nloja.arquem.com.br"),
    ["arquem.com.br", "www.arquem.com.br", "loja.arquem.com.br"],
  );
  assert.deepEqual(parseAllowedDomains(["arquem.com.br", "arquem.com.br"]), ["arquem.com.br"]);
  assert.deepEqual(parseAllowedDomains(null), []);
  assert.deepEqual(parseAllowedDomains(["http://localhost:3000"]), ["localhost"]);
  assert.throws(() => parseAllowedDomains(["maquina local"]), /Endereco de site invalido/);
});

test("monta o codigo de instalacao com a chave e o endereco da API", () => {
  assert.equal(
    embedSnippetFor("https://app.exemplo.com/", "https://api.exemplo.com/", "CHAVE123"),
    '<script src="https://app.exemplo.com/widget.js" data-widget-key="CHAVE123" data-api="https://api.exemplo.com" async></script>',
  );
});

test("nao gera snippet relativo se a URL publica do widget estiver ausente ou invalida", () => {
  for (const widgetBaseUrl of [undefined, "", "   ", "/app"]) {
    assert.equal(embedSnippetFor(widgetBaseUrl, "https://api.exemplo.com", "CHAVE123"), "");
  }
});
