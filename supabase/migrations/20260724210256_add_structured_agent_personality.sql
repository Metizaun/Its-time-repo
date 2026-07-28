-- Personality becomes structured agent configuration instead of prompt text or sampling.

ALTER TABLE agents.ai_agents
  ADD COLUMN personality_profile text NOT NULL DEFAULT 'balanced',
  ADD CONSTRAINT ai_agents_personality_profile_check
    CHECK (personality_profile IN ('surgical', 'consultative', 'balanced', 'dynamic', 'enthusiastic'));

UPDATE agents.ai_agents
SET personality_profile = CASE
  WHEN temperature < 0.18 THEN 'surgical'
  WHEN temperature < 0.33 THEN 'consultative'
  WHEN temperature < 0.50 THEN 'balanced'
  WHEN temperature < 0.68 THEN 'dynamic'
  ELSE 'enthusiastic'
END;

UPDATE agents.ai_agents
SET system_prompt = btrim(
  regexp_replace(
    system_prompt,
    E'\\n*## Estilo de Comunicacao\\n(.|\\n)*$',
    '',
    'i'
  )
)
WHERE system_prompt ~* E'## Estilo de Comunicacao';

UPDATE agents.ai_agents
SET system_prompt = btrim(
  regexp_replace(
    system_prompt,
    E'\\n*\\[ARQUEM_MANAGED_TONE_START\\](.|\\n)*?\\[ARQUEM_MANAGED_TONE_END\\]\\n*',
    E'\\n',
    'i'
  )
)
WHERE system_prompt LIKE '%[ARQUEM_MANAGED_TONE_START]%';

NOTIFY pgrst, 'reload schema';
