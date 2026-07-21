# 🧩 02 — Componentes e Estados
**White Minimalist SaaS — Soft UI Edition**

> Biblioteca visual de todos os componentes reutilizáveis do CRM Its Time.
> Todos os valores vêm exclusivamente de `01-tokens.md`.

---

## 5.1 Inputs e Formulários

### Anatomia de um Input

```
┌─────────────────────────────────────────┐
│ LABEL                           [Req*]  │   ← 12px, semibold, gray-600, uppercase
│                                         │
│ ┌─────────────────────────────────────┐ │   ← border-radius: 8px
│ │ 🔍  Placeholder text              ▾ │ │   ← height: 40px (MD)
│ └─────────────────────────────────────┘ │   ← shadow: inset (Soft UI)
│                                         │
│  Helper text ou mensagem de erro        │   ← 12px, gray-500 / error-600
└─────────────────────────────────────────┘
```

### CSS Base

```css
/* ── INPUT BASE ── */
.input {
  height:           var(--height-input-md);   /* 40px */
  padding:          0 var(--input-px-md);     /* 0 16px */
  border-radius:    var(--radius-md);          /* 8px */

  background-color: var(--color-surface-1);   /* #FFFFFF */
  border:           var(--border-width-sm) solid var(--border-input);
  box-shadow:       var(--shadow-inset);

  font-family:      var(--font-family-sans);
  font-size:        var(--text-base);          /* 16px */
  font-weight:      var(--font-regular);       /* 400 */
  color:            var(--color-gray-900);

  transition:       var(--transition-colors),
                    box-shadow var(--duration-fast) var(--ease-out);
}

/* ── PLACEHOLDER ── */
.input::placeholder {
  color:       var(--color-gray-500);
  font-weight: var(--font-regular);
}

/* ── FOCUS ── */
.input:focus {
  outline:      none;
  border-color: var(--border-focus);    /* #E8511A */
  box-shadow:   var(--shadow-focus);
}

/* ── ERROR ── */
.input--error {
  border-color: var(--color-error-500);
  box-shadow:   inset 2px 2px 5px rgba(26, 24, 20, 0.06),
                inset -2px -2px 5px rgba(255, 255, 253, 0.85),
                0 0 0 3px rgba(239, 68, 68, 0.12);
}

/* ── DISABLED ── */
.input:disabled {
  background-color: var(--color-bg-muted);
  color:            var(--color-gray-400);
  cursor:           not-allowed;
  box-shadow:       none;
  border-color:     var(--border-subtle);
  opacity:          0.6;
}

/* ── SIZES ── */
.input--sm {
  height:        var(--height-input-sm);   /* 32px */
  padding:       0 var(--input-px-sm);     /* 0 12px */
  font-size:     var(--text-sm);           /* 14px */
  border-radius: var(--radius-sm);         /* 6px */
}

.input--lg {
  height:        var(--height-input-lg);   /* 48px */
  padding:       0 var(--input-px-lg);     /* 0 20px */
  font-size:     var(--text-lg);           /* 18px */
  border-radius: var(--radius-lg);         /* 12px */
}
```

### Form Label

```css
.form-label {
  display:         block;
  margin-bottom:   var(--space-2);        /* 8px */
  font-size:       var(--text-xs);        /* 12px */
  font-weight:     var(--font-semibold);  /* 600 */
  letter-spacing:  var(--tracking-wide);
  color:           var(--color-gray-600);
  text-transform:  uppercase;
}

.form-label--required::after {
  content: ' *';
  color:   var(--color-error-500);
}
```

### Helper Text / Erro

```css
.form-helper {
  margin-top:  var(--space-1);      /* 4px */
  font-size:   var(--text-xs);      /* 12px */
  font-weight: var(--font-regular);
  color:       var(--color-gray-500);
}

.form-helper--error {
  color:       var(--color-error-600);
  font-weight: var(--font-medium);
}
```

### Regra de Microcopy em Formulários

- Helper text existe para destravar a ação, não para explicar arquitetura.
- O usuário deve ver linguagem operacional curta, nunca termos de implementação como `worker`, `endpoint`, `API`, `prompt`, `payload`, `bootstrap` ou nomes internos de jobs.
- Se o campo já comunica a decisão sozinho, prefira remover o helper text em vez de preencher espaço.
- Estados do campo devem dar feedback visual suficiente para que a seleção seja percebida sem texto redundante.
- Em formulários densos, priorize `label + campo + estado` antes de qualquer descrição.
- Nunca exponha regra interna, código, enum, ID, apelido técnico ou lista operacional no texto da interface.
- Não crie caixas explicativas ao lado de selects, radios ou toggles autoexplicativos.
- Helpers devem ter no máximo uma linha curta e comunicar somente restrição ou consequência operacional.

### Fluxos Mutuamente Exclusivos

- Use abas ou controle segmentado para modos que não podem coexistir.
- A troca de modo substitui o editor; nunca anexa um segundo formulário abaixo do primeiro.
- Preserve rascunhos quando isso evitar perda acidental, mas serialize apenas o modo ativo.
- Um formulário não deve ser envolvido por superfície laranja, `primary-50` ou outro tint decorativo.
- Detalhes técnicos e IDs manuais ficam fora do fluxo principal e só aparecem em ferramentas administrativas específicas.

### Controles Auxiliares

- Checkbox auxiliar nunca vira card, box destacada ou bloco chamativo.
- Quando o controle principal for um input de ação, o auxiliar deve vir abaixo dele, menor e mais quieto.
- Use `checkbox + label curta` em uma linha simples. Sem explicação longa por padrão.
- O protagonismo visual fica no campo principal; o auxiliar só complementa a decisão.

### Select e Textarea

```css
.select {
  /* Herda tudo do .input */
  appearance:         none;
  background-image:   url("data:image/svg+xml,...chevron..."); /* ícone */
  background-repeat:  no-repeat;
  background-position: right 16px center;
  padding-right:      40px;
}

.textarea {
  /* Herda tudo do .input */
  height:      auto;
  min-height:  100px;
  padding:     var(--space-3) var(--input-px-md); /* 12px 16px */
  resize:      vertical;
  line-height: var(--leading-relaxed);
}
```

### Espaçamento de Formulários

```css
.form-group {
  display:        flex;
  flex-direction: column;
  gap:            var(--space-5);   /* 20px entre campos */
}

.form-row {
  display:               grid;
  grid-template-columns: 1fr 1fr;
  gap:                   var(--space-4);  /* 16px entre colunas */
}

.form-section + .form-section {
  margin-top:  var(--space-8);   /* 32px */
  padding-top: var(--space-8);
  border-top:  var(--divider);
}
```

---

## 5.2 Botões

### Anatomia (MD — padrão)
```
Height: 40px | Padding: 10px 16px | Radius: 12px | Font: 14px SemiBold | Icon gap: 8px
```

### Solid (Primário — ação principal)

```css
.btn-solid {
  height:        var(--height-input-md);       /* 40px */
  padding:       var(--btn-py-md) var(--btn-px-md); /* 10px 16px */
  border-radius: var(--radius-lg);             /* 12px */
  border:        none;

  background-color: var(--color-primary-500);  /* #E8511A */
  color:         #FFFFFF;

  font-family:   var(--font-family-sans);
  font-size:     var(--text-sm);               /* 14px */
  font-weight:   var(--font-semibold);         /* 600 */
  letter-spacing: 0.01em;

  box-shadow:    var(--shadow-primary);
  cursor:        pointer;

  display:       inline-flex;
  align-items:   center;
  gap:           var(--space-2);               /* 8px */

  transition:    var(--transition-colors),
                 var(--transition-shadow),
                 transform var(--duration-fast) var(--ease-out);
}

.btn-solid:hover {
  background-color: var(--color-primary-600);  /* #C94010 */
  box-shadow:       var(--shadow-primary-hover);
  transform:        translateY(-1px);
}

.btn-solid:active {
  background-color: var(--color-primary-700);
  box-shadow:       var(--shadow-inset);
  transform:        translateY(0);
}

.btn-solid:focus-visible {
  outline:    none;
  box-shadow: var(--shadow-focus);
}

.btn-solid:disabled {
  background-color: var(--color-gray-200);
  color:            var(--color-gray-400);
  box-shadow:       none;
  cursor:           not-allowed;
  transform:        none;
}
```

### Outline (Secundário)

```css
.btn-outline {
  height:        var(--height-input-md);
  padding:       var(--btn-py-md) var(--btn-px-md);
  border-radius: var(--radius-lg);
  border:        var(--border-width-md) solid var(--color-primary-500);

  background-color: transparent;
  color:         var(--color-primary-500);

  font-size:     var(--text-sm);
  font-weight:   var(--font-semibold);
  box-shadow:    var(--shadow-sm);

  display:       inline-flex;
  align-items:   center;
  gap:           var(--space-2);
  transition:    var(--transition-all);
}

.btn-outline:hover {
  background-color: var(--color-primary-50);
  box-shadow:       var(--shadow-md);
  transform:        translateY(-1px);
}

.btn-outline:active {
  background-color: var(--color-primary-100);
  box-shadow:       var(--shadow-inset);
  transform:        translateY(0);
}

.btn-outline:disabled {
  border-color: var(--color-gray-200);
  color:        var(--color-gray-400);
  box-shadow:   none;
  cursor:       not-allowed;
}
```

### Ghost (Terciário)

```css
.btn-ghost {
  height:        var(--height-input-md);
  padding:       var(--btn-py-md) var(--btn-px-md);
  border-radius: var(--radius-lg);
  border:        none;

  background-color: transparent;
  color:         var(--color-gray-700);

  font-size:     var(--text-sm);
  font-weight:   var(--font-medium);
  box-shadow:    none;

  display:       inline-flex;
  align-items:   center;
  gap:           var(--space-2);
  transition:    var(--transition-colors),
                 box-shadow var(--duration-fast) var(--ease-out);
}

.btn-ghost:hover {
  background-color: var(--color-bg-subtle);
  box-shadow:       var(--shadow-sm);
  color:            var(--color-gray-900);
}

.btn-ghost:active {
  background-color: var(--color-bg-muted);
  box-shadow:       var(--shadow-inset);
}
```

### Tamanhos

```css
.btn--sm {
  height:        var(--height-input-sm);       /* 32px */
  padding:       var(--btn-py-sm) var(--btn-px-sm); /* 6px 12px */
  border-radius: var(--radius-md);             /* 8px — proporcional */
  font-size:     var(--text-xs);               /* 12px */
}

.btn--lg {
  height:        var(--height-input-lg);       /* 48px */
  padding:       var(--btn-py-lg) var(--btn-px-lg); /* 14px 24px */
  border-radius: var(--radius-xl);             /* 16px */
  font-size:     var(--text-base);             /* 16px */
}

.btn--xl {
  height:        var(--height-input-xl);       /* 56px */
  padding:       var(--btn-py-xl) var(--btn-px-xl); /* 18px 32px */
  border-radius: var(--radius-2xl);            /* 20px */
  font-size:     var(--text-lg);               /* 18px */
  font-weight:   var(--font-bold);             /* 700 */
}

.btn--pill   { border-radius: var(--radius-full); }
.btn--full   { width: 100%; justify-content: center; }
.btn--icon   { padding: var(--btn-py-md); aspect-ratio: 1; }
```

### Grupos de Botões

```css
.btn-group       { display: inline-flex; gap: var(--space-2); } /* 8px */
.btn-group--form { display: flex; justify-content: flex-end; gap: var(--space-3); margin-top: var(--space-6); }
```

---

## 5.3 Cards e Containers

### Regra de Sofisticacao para Superficies Operacionais

Em telas densas como Dashboard, Calendar, Pipeline e Admin, a sofisticacao vem de continuidade visual e precisao de acabamento. Use o `src/components/calendar/` como referencia pratica: containers brancos, borda sutil, shadow leve, cantos generosos, headers discretos e estados de hover quase silenciosos.

- Cards representam uma unidade real de informacao, nao uma secao inteira da pagina.
- Evite cards dentro de cards; use grids, headers e divisores sutis dentro do mesmo container.
- Se o conteudo e recorrente ou escaneavel, priorize densidade, alinhamento e numeros tabulares.
- O card nao deve explicar demais. Titulo curto, subtitulo curto, valor claro.
- Em dashboards, o excesso de copy reduz sofisticacao. A hierarquia deve fazer o trabalho.

### Card Padrão

```css
.card {
  background-color: var(--color-surface-1);     /* #FFFFFF */
  border-radius:    var(--radius-xl);           /* 16px */
  border:           var(--border-width-sm) solid var(--border-default);
  box-shadow:       var(--shadow-sm);
  padding:          var(--space-6);             /* 24px */
  transition:       var(--transition-shadow),
                    transform var(--duration-default) var(--ease-out);
}

/* Clicável */
.card--interactive { cursor: pointer; }

.card--interactive:hover {
  box-shadow: var(--shadow-md);
  transform:  translateY(-2px);
}

.card--interactive:active {
  box-shadow: var(--shadow-inset);
  transform:  translateY(0);
}
```

### Card KPI / Métrica

```css
.card-kpi {
  background-color: var(--color-surface-1);
  border-radius:    var(--radius-2xl);          /* 20px */
  border:           var(--border-width-sm) solid var(--border-default);
  box-shadow:       var(--shadow-sm);
  padding:          var(--space-6);
  display:          flex;
  flex-direction:   column;
  gap:              var(--space-2);
}

.card-kpi__label {
  font-family:     var(--font-family-mono);
  font-size:       var(--text-xs);
  font-weight:     var(--font-medium);
  letter-spacing:  var(--tracking-wider);
  text-transform:  uppercase;
  color:           var(--color-gray-500);
}

.card-kpi__value {
  font-size:      var(--text-3xl);              /* 30px */
  font-weight:    var(--font-extrabold);        /* 800 */
  color:          var(--color-gray-900);
  letter-spacing: var(--tracking-tight);
  line-height:    var(--leading-none);
}

.card-kpi__delta--positive { color: var(--color-success-600); font-size: var(--text-sm); font-weight: var(--font-semibold); }
.card-kpi__delta--negative { color: var(--color-error-600);   font-size: var(--text-sm); font-weight: var(--font-semibold); }
```

### Card de Seção com Header

```css
.card-section {
  background-color: var(--color-surface-1);
  border-radius:    var(--radius-xl);
  border:           var(--border-width-sm) solid var(--border-default);
  box-shadow:       var(--shadow-sm);
  overflow:         hidden;
}

.card-section__header {
  display:         flex;
  align-items:     center;
  justify-content: space-between;
  padding:         var(--space-5) var(--space-6);   /* 20px 24px */
  border-bottom:   var(--divider);
}

.card-section__title {
  font-size:   var(--text-base);
  font-weight: var(--font-semibold);
  color:       var(--color-gray-900);
}

.card-section__body   { padding: var(--space-6); }

.card-section__footer {
  padding:          var(--space-4) var(--space-6);
  border-top:       var(--divider);
  background-color: var(--color-bg-subtle);
}
```

### Card de Destaque (Fiel às referências — barra laranja→pink)

```css
.card-accent {
  background-color: var(--color-surface-1);
  border-radius:    var(--radius-xl);
  border:           var(--border-width-sm) solid var(--border-default);
  box-shadow:       var(--shadow-sm);
  padding:          var(--space-6);
  position:         relative;
}

/* Barra de acento no topo */
.card-accent::before {
  content:       '';
  position:      absolute;
  top:           0;
  left:          0;
  right:         0;
  height:        3px;
  background:    var(--gradient-coral-pink);
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
}
```

---

## 5.4 Navegação

### Topbar

```css
.topbar {
  height:           var(--layout-topbar-height);  /* 56px */
  background-color: var(--color-surface-1);
  border-bottom:    var(--border-width-sm) solid var(--border-default);
  box-shadow:       0 1px 0 var(--border-default), var(--shadow-sm);
  display:          flex;
  align-items:      center;
  padding:          0 var(--space-6);
  gap:              var(--space-4);
  position:         sticky;
  top:              0;
  z-index:          100;
}
```

### Sidebar

```css
.sidebar {
  width:            var(--layout-sidebar-width);   /* 240px */
  height:           100vh;
  background-color: var(--color-bg-subtle);
  border-right:     var(--border-width-sm) solid var(--border-default);
  display:          flex;
  flex-direction:   column;
  padding:          var(--space-4) var(--space-3);
  gap:              var(--space-1);
  overflow-y:       auto;
  position:         sticky;
  top:              0;
}

/* Item de navegação */
.nav-item {
  height:          40px;
  border-radius:   var(--radius-lg);       /* 12px */
  padding:         0 var(--space-3);
  display:         flex;
  align-items:     center;
  gap:             var(--space-3);
  font-size:       var(--text-sm);
  font-weight:     var(--font-medium);
  color:           var(--color-gray-600);
  text-decoration: none;
  transition:      var(--transition-colors),
                   box-shadow var(--duration-fast) var(--ease-out);
}

.nav-item:hover {
  background-color: var(--color-surface-1);
  color:            var(--color-gray-900);
  box-shadow:       var(--shadow-sm);
}

.nav-item--active {
  background-color: var(--color-surface-1);
  color:            var(--color-primary-500);
  font-weight:      var(--font-semibold);
  box-shadow:       var(--shadow-sm);
}

/* Label de grupo de nav */
.nav-group-label {
  font-family:    var(--font-family-mono);
  font-size:      var(--text-xs);
  font-weight:    var(--font-medium);
  letter-spacing: var(--tracking-wider);
  text-transform: uppercase;
  color:          var(--color-gray-400);
  padding:        var(--space-3) var(--space-3) var(--space-1);
  margin-top:     var(--space-4);
}
```

---

## 5.5 Badges e Tags

> **Regra de uso:** badges são proibidos por padrão. Só podem ser adicionados quando o usuário solicitar explicitamente um badge naquela interface. Um badge existente não cria precedente para novos usos; prefira texto simples, ícone, toggle ou estado do próprio controle.

Badges editoriais de taxonomia — como “Novidade”, “Melhoria”, “Correção” e “Hotfix” — não devem acompanhar cada item. Em timelines, changelogs e modais de novidades, use um ícone editorial maior com um dos gradientes autorizados. Preserve o nome da categoria apenas como texto acessível quando ele não for necessário para a leitura visual.

```css
.badge {
  display:        inline-flex;
  align-items:    center;
  gap:            var(--space-1);
  padding:        2px var(--space-2);         /* 2px 8px */
  border-radius:  var(--radius-full);
  font-family:    var(--font-family-mono);
  font-size:      var(--text-xs);
  font-weight:    var(--font-medium);
  letter-spacing: var(--tracking-wide);
  text-transform: uppercase;
  white-space:    nowrap;
}

/* Variantes — fundo tinto, texto escuro correspondente */
.badge--primary { background-color: var(--color-primary-50);  color: var(--color-primary-700); }
.badge--success { background-color: var(--color-success-bg);  color: var(--color-success-600); }
.badge--error   { background-color: var(--color-error-bg);    color: var(--color-error-600); }
.badge--warning { background-color: var(--color-warning-bg);  color: var(--color-warning-600); }
.badge--neutral { background-color: var(--color-bg-muted);    color: var(--color-gray-600); }
```

---

## 5.6 Modal / Dialog

```css
/* Backdrop */
.modal-backdrop {
  position:         fixed;
  inset:            0;
  background-color: rgba(26, 24, 20, 0.45);
  backdrop-filter:  blur(4px);
  z-index:          200;
  display:          grid;
  place-items:      center;
  padding:          var(--space-4);
}

/* Container */
.modal {
  background-color: var(--color-surface-1);
  border-radius:    var(--radius-3xl);    /* 24px */
  box-shadow:       var(--shadow-modal);
  width:            100%;
  max-width:        560px;
  max-height:       90vh;
  overflow:         hidden;
  display:          flex;
  flex-direction:   column;
  animation:        modal-enter var(--duration-slow) var(--ease-spring);
}

@keyframes modal-enter {
  from { opacity: 0; transform: translateY(16px) scale(0.97); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

.modal__header {
  display:         flex;
  align-items:     center;
  justify-content: space-between;
  padding:         var(--space-6);
  border-bottom:   var(--divider);
}

.modal__title {
  font-size:   var(--text-xl);
  font-weight: var(--font-bold);
  color:       var(--color-gray-900);
}

.modal__body {
  padding:    var(--space-6);
  overflow-y: auto;
  flex:       1;
}

.modal__footer {
  display:          flex;
  justify-content:  flex-end;
  gap:              var(--space-3);
  padding:          var(--space-5) var(--space-6);
  border-top:       var(--divider);
  background-color: var(--color-bg-subtle);
  border-radius:    0 0 var(--radius-3xl) var(--radius-3xl);
}
```

---

## 5.7 Section Label (Componente Identitário)

O componente mais característico das referências visuais: micro-label de seção com barra laranja acima.

```css
.section-label {
  display:        inline-flex;
  flex-direction: column;
  gap:            var(--space-1);  /* 4px */
}

/* Barra laranja — 20px × 2px */
.section-label::before {
  content:          '';
  display:          block;
  width:            20px;
  height:           2px;
  background-color: var(--color-primary-500);
  border-radius:    var(--radius-full);
}

.section-label__text {
  font-family:    var(--font-family-mono);
  font-size:      var(--text-xs);         /* 12px */
  font-weight:    var(--font-medium);     /* 500 */
  letter-spacing: var(--tracking-wider);
  text-transform: uppercase;
  color:          var(--color-gray-600);
}
```

**HTML:**
```html
<div class="section-label">
  <span class="section-label__text">Dashboard</span>
</div>
```

---

## 5.8 Empty States

```css
.empty-state {
  display:        flex;
  flex-direction: column;
  align-items:    center;
  text-align:     center;
  padding:        var(--space-16) var(--space-8); /* 64px 32px */
  gap:            var(--space-4);
}

.empty-state__icon {
  width:            64px;
  height:           64px;
  border-radius:    var(--radius-2xl);
  background-color: var(--color-primary-50);
  display:          grid;
  place-items:      center;
  color:            var(--color-primary-500);
  box-shadow:       var(--shadow-sm);
}

.empty-state__title {
  font-size:   var(--text-lg);
  font-weight: var(--font-bold);
  color:       var(--color-gray-900);
}

.empty-state__description {
  font-size:   var(--text-sm);
  color:       var(--color-gray-500);
  max-width:   320px;
  line-height: var(--leading-relaxed);
}
```

---

## 5.9 Tabelas

```css
.table {
  width:           100%;
  border-collapse: separate;
  border-spacing:  0;
}

.table th {
  padding:        var(--space-3) var(--space-4);   /* 12px 16px */
  font-family:    var(--font-family-mono);
  font-size:      var(--text-xs);
  font-weight:    var(--font-semibold);
  letter-spacing: var(--tracking-wide);
  text-transform: uppercase;
  color:          var(--color-gray-500);
  text-align:     left;
  border-bottom:  var(--border-width-md) solid var(--border-strong);
  background-color: var(--color-bg-subtle);
}

.table th:first-child { border-radius: var(--radius-md) 0 0 0; }
.table th:last-child  { border-radius: 0 var(--radius-md) 0 0; }

.table td {
  padding:        var(--space-4);                  /* 16px */
  font-size:      var(--text-sm);
  color:          var(--color-gray-700);
  border-bottom:  var(--border-width-sm) solid var(--border-subtle);
  vertical-align: middle;
}

.table tr:hover td    { background-color: var(--color-bg-subtle); }
.table tr:last-child td { border-bottom: none; }
```

---

## 5.10 Checklist de Implementação

Antes de dar merge em qualquer componente novo:

- [ ] Usa tokens CSS (`--var`) — zero valores hardcoded
- [ ] Tem estado `:hover`, `:focus`, `:active`, `:disabled`
- [ ] Focus visível via `box-shadow: var(--shadow-focus)` — nunca `outline: none` sem substituto
- [ ] Respeita `prefers-reduced-motion`
- [ ] Border-radius segue a tabela de proporções (seção 9 de `01-tokens.md`)
- [ ] Sombras usam os tokens de elevação Soft UI
- [ ] Fontes usam os tokens de tipografia
- [ ] Testado em 1280px, 1024px e 768px
