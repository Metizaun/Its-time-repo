# QueroMed - Configuração do Cliente

Configuração exclusiva da QueroMed:

- Conta cliente (`aces_id = 6`) com 1 Administrador e 4 Vendedores dedicados;
- 4 Empresas cadastradas: Curitiba — Centro, Pinheirinho — Curitiba, Pinhais e Fazenda Rio Grande;
- Redirecionamento por empresa via `crm.empresa_memberships`;
- Agendas em grade de 20 em 20 minutos com pausa de almoço (12:00 - 13:00) e último horário às 17:40;
- 4 instâncias WhatsApp Evolution (`queromed_centro`, `queromed_pinheirinho`, `queromed_pinhais`, `queromed_fazenda`);
- 4 Agentes vinculados às 4 instâncias com o prompt principal do Henrique;
- Subagente de apoio clínico (`queromed_clinical_assistant`).

## Aplicação no banco local

Para rodar a criação no banco de dados local:
1. Execute o script `seed-queromed.sql` no Supabase SQL Editor ou psql.
2. Em seguida, valide o manifesto via CLI:
```bash
npm run client-config:apply -- --config client-configs/queromed/manifest.json --aces-id 6 --instance queromed_centro --dry-run
```
