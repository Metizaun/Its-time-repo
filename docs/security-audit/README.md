# Auditoria de seguranca — Its Time CRM (chat-query)

Relatorio: [`relatorio-auditoria-seguranca.pdf`](relatorio-auditoria-seguranca.pdf) — 46 paginas, pt-BR.
Data da revisao: 04/09/2026 · branch `meta` · commit `36fa32a`.

## Conteudo do PDF

1. Capa com stack detectada e escopo auditado
2. Nota metodologica (como cada uma das 5 categorias foi mapeada para esta stack)
3. Resumo executivo com grafico de rosca por severidade e barras por categoria
4. 20 pontos fortes verificados (com arquivo:linha)
5. 6 pontos fracos / riscos centrais
6. Indice e detalhamento dos 18 achados por categoria
7. Recomendacoes priorizadas (P1 a P4)
8. Anexo de cobertura da revisao
9. Secao "ISSUES PARA O GITHUB" — 14 issues em Markdown, prontas para copiar

## Regerar o relatorio

Ambiente isolado, nada instalado globalmente:

```bash
python -m venv .venv
.venv/Scripts/python -m pip install reportlab matplotlib   # Windows
.venv/bin/python     -m pip install reportlab matplotlib   # Linux/macOS

.venv/Scripts/python docs/security-audit/gerar_relatorio.py
```

## Arquivos

| Arquivo | Papel |
| --- | --- |
| `dados_auditoria.py` | Somente dados: achados, pontos fortes/fracos, recomendacoes, metodologia. Edite aqui para atualizar o relatorio. |
| `gerar_relatorio.py` | Layout, graficos e montagem do PDF. Nao contem dados da auditoria. |
| `relatorio-auditoria-seguranca.pdf` | Saida gerada. |

## Nota

O relatorio **nao reproduz credenciais vivas**. A senha de root do VPS encontrada em
`scripts/*vps*.js` (achado F04) aparece redigida no PDF; o valor real esta apenas no
arquivo local, que e ignorado pelo Git.
