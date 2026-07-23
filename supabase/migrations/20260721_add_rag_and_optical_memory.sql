-- Migration: Add RAG (pgvector) and Optical Profile Memory to CRM AI
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Add memory fields to ai_lead_state
ALTER TABLE crm.ai_lead_state 
ADD COLUMN IF NOT EXISTS optical_profile JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS memory_summary TEXT DEFAULT NULL;

-- Table for vector embeddings (RAG)
CREATE TABLE IF NOT EXISTS crm.ai_knowledge_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aces_id INT NOT NULL,
    agent_id UUID REFERENCES crm.ai_agents(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    embedding extensions.vector(768),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for vector similarity search
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_embeddings_vector 
ON crm.ai_knowledge_embeddings 
USING ivfflat (embedding extensions.vector_cosine_ops) WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_embeddings_aces_agent 
ON crm.ai_knowledge_embeddings (aces_id, agent_id);

-- RPC Function for Cosine Similarity Search
CREATE OR REPLACE FUNCTION crm.match_knowledge_embeddings(
    p_aces_id INT,
    p_agent_id UUID,
    query_embedding extensions.vector(768),
    match_threshold FLOAT,
    match_count INT
)
RETURNS TABLE (
    id UUID,
    content TEXT,
    metadata JSONB,
    similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        k.id,
        k.content,
        k.metadata,
        1 - (k.embedding <=> query_embedding) AS similarity
    FROM crm.ai_knowledge_embeddings k
    WHERE k.aces_id = p_aces_id
      AND (k.agent_id IS NULL OR k.agent_id = p_agent_id)
      AND 1 - (k.embedding <=> query_embedding) > match_threshold
    ORDER BY k.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;
