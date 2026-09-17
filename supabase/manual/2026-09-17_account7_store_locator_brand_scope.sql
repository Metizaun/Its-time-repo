-- One-off, account-specific fix for aces_id = 7 (Instituto dos Oculos / Saude Perfeita).
-- NOT a versioned migration: the mapping below (which crm.empresas belongs to which brand) is
-- curated by hand from crm.empresas.name and is not derivable from the schema. Apply this by hand
-- via psql AFTER the general backfill migrations
-- (20260917160000/161000/162000) are already applied.
--
-- Confirmed 2026-09-17 against production (aces_id = 7):
--   Instituto (agent 2edfce86-2888-43db-87c3-ede2ec0caace, "Bento - Instituto dos Oculos"):
--     bd08dd58-0b43-4c95-b01f-e4558e9e37c7  Instituto dos Oculos - Marechal
--   Saudeperfeita (agent cf1fe9d2-3af2-445b-9611-42ff71220927, "Henrique - Saude Perfeita"):
--     f080a069-3616-4c5e-9867-c85e624825b5  Saude Perfeita - Portao (active)
--     9b059cc9-59c8-47c6-a652-31b66c9b521d  Saude Perfeita - Boqueirao (inactive)
--     7e3bb475-8ca7-4f15-aeb7-bcb3bb2e8993  Saude Perfeita - Campo Largo (inactive)
--     99c4db83-6c2a-4e1f-9819-afd5e8caceaa  Saude Perfeita - Colombo (inactive)
--     cc0a006e-efd7-49da-a04d-29ad6650644c  Saude Perfeita - Fazendinha (inactive)
--     24c633fd-c074-4923-8608-e60ba833d8bc  Saude Perfeita - Joinville (inactive)
--     d5328791-e766-4e07-af8e-6c880020d103  Saude Perfeita - Piraquara (inactive)
--     247fe6ed-5dd5-486b-9268-b316f72dd53b  Saude Perfeita - Ponta Grossa (inactive)
--
-- Inactive Saude Perfeita units are included on purpose: crm.lookup_company_directory_v2 already
-- filters is_active IS TRUE, so listing them here is inert today, but it means reactivating any of
-- them later correctly makes them visible to Henrique (and only Henrique) without anyone having to
-- remember to update this list again.

update agents.agent_tools
set config = config || jsonb_build_object(
  'allowedCompanyIds',
  jsonb_build_array('bd08dd58-0b43-4c95-b01f-e4558e9e37c7')
),
updated_at = now()
where aces_id = 7
  and tool_key = 'store_locator'
  and agent_id = '2edfce86-2888-43db-87c3-ede2ec0caace';

update agents.agent_tools
set config = config || jsonb_build_object(
  'allowedCompanyIds',
  jsonb_build_array(
    'f080a069-3616-4c5e-9867-c85e624825b5',
    '9b059cc9-59c8-47c6-a652-31b66c9b521d',
    '7e3bb475-8ca7-4f15-aeb7-bcb3bb2e8993',
    '99c4db83-6c2a-4e1f-9819-afd5e8caceaa',
    'cc0a006e-efd7-49da-a04d-29ad6650644c',
    '24c633fd-c074-4923-8608-e60ba833d8bc',
    'd5328791-e766-4e07-af8e-6c880020d103',
    '247fe6ed-5dd5-486b-9268-b316f72dd53b'
  )
),
updated_at = now()
where aces_id = 7
  and tool_key = 'store_locator'
  and agent_id = 'cf1fe9d2-3af2-445b-9611-42ff71220927';

-- Verification query to run right after:
-- select agent_id, config->'allowedCompanyIds' from agents.agent_tools
-- where aces_id = 7 and tool_key = 'store_locator';
