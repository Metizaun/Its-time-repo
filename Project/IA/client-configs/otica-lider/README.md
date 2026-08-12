# Otica Lider

Configuracao exclusiva da Otica Lider:

- agente principal de otica ("Bruna - Otica Lider"), vinculado a instancia existente `Oticas_Lider` (aces_id 9) e ao template `optics-consultant`;
- sem subagentes;
- apenas a matriz de Erechim (CNPJ 05.070.272/0001-81) cadastrada; as filiais de Aratiba e Erechim-bairro (CNPJs .0002-62 e .0003-43) nao foram cadastradas como empresas porque nao foram solicitadas, mas o prompt menciona Aratiba caso o cliente pergunte;
- e-mail, Instagram, Facebook e site institucional NAO foram incluidos no cadastro nem tratados como canais oficiais no prompt: o e-mail encontrado (financeiro@oticalider.net.br) apareceu associado publicamente a filial de Aratiba e nao foi confirmado como canal da matriz;
- sem valores de lente/armacao "a partir de" cadastrados (cliente ainda nao informou precos) - o prompt instrui a IA a nunca inventar preco e sempre encaminhar o valor exato para a equipe;
- RAG desativado; agenda bloqueada para a IA (`aiBookingEnabled: false`);
- `active: false` no manifesto de proposito: o agente deve ser aplicado inativo para revisao humana do prompt antes de ativar.

## Aplicar

```bash
npm run client-config:apply -- --config client-configs/otica-lider/manifest.json --aces-id 9 --instance Oticas_Lider --dry-run
```

Revisar o plano e, se estiver correto, repetir sem `--dry-run`.

## Passos pendentes fora deste manifesto (nao feitos pelo aplicador)

1. **Ativar o agente** (`ai_agents.is_active = true`) depois de revisar o prompt.
2. **Habilitar a tool `prescription_analyst`** (receituario) — hoje o aplicador cria a tool desabilitada (`needs_config`), igual acontece para todo cliente novo do template; os demais clientes (Cardeal, Lavie, Dra. Oculos) tiveram essa tool ligada manualmente depois do provisionamento.
3. **Visagismo**: tool fica desabilitada ate a loja cadastrar o catalogo (`agents.visagism_catalog_items`) com as armacoes/fotos, conforme combinado ("cliente configura").
4. **Audio (ElevenLabs)**: tool fica desabilitada ate escolher e configurar uma `voiceId` (nenhum cliente tem audio ativo em producao hoje).
5. Conectar o WhatsApp da instancia `Oticas_Lider` (QR code) — status atual: `pending_qr`.
6. Quando a loja informar valores de entrada de lentes/armacoes, atualizar `agent-principal.md` com os precos "a partir de" (mesmo padrao usado em Cardeal/Lavie/Dra. Oculos) e reaplicar o manifesto.
