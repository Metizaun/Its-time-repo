CREATE SCHEMA IF NOT EXISTS research;

GRANT USAGE ON SCHEMA research TO anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE
ON ALL TABLES IN SCHEMA research
TO authenticated, service_role;

GRANT USAGE, SELECT
ON ALL SEQUENCES IN SCHEMA research
TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA research
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA research
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS research.scrape_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  profile_username TEXT NOT NULL,
  apify_run_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_count INTEGER NOT NULL DEFAULT 0 CHECK (result_count >= 0),
  error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT scrape_jobs_org_run_unique UNIQUE (organization_id, apify_run_id)
);

CREATE TABLE IF NOT EXISTS research.scrape_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  scrape_job_id UUID NOT NULL REFERENCES research.scrape_jobs(id) ON DELETE CASCADE,
  profile_username TEXT NOT NULL,
  platform_post_id TEXT NULL,
  type TEXT NOT NULL CHECK (type IN ('photo', 'reel')),
  permalink TEXT NOT NULL,
  thumbnail_url TEXT NULL,
  display_url TEXT NULL,
  video_url TEXT NULL,
  caption TEXT NULL,
  likes_count INTEGER NULL CHECK (likes_count IS NULL OR likes_count >= 0),
  comments_count INTEGER NULL CHECK (comments_count IS NULL OR comments_count >= 0),
  views_count INTEGER NULL CHECK (views_count IS NULL OR views_count >= 0),
  posted_at TIMESTAMPTZ NULL,
  comments JSONB NULL,
  raw_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT scrape_items_org_job_permalink_unique UNIQUE (organization_id, scrape_job_id, permalink)
);

CREATE TABLE IF NOT EXISTS research.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  competitor_username TEXT NOT NULL,
  description TEXT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT projects_org_competitor_unique UNIQUE (organization_id, competitor_username)
);

CREATE TABLE IF NOT EXISTS research.project_saved_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES research.projects(id) ON DELETE CASCADE,
  scrape_item_id UUID NOT NULL REFERENCES research.scrape_items(id) ON DELETE CASCADE,
  selected_by_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT project_saved_items_unique UNIQUE (project_id, scrape_item_id)
);

CREATE TABLE IF NOT EXISTS research.project_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES research.projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('analysis', 'notes', 'script')),
  content_md TEXT NOT NULL DEFAULT '',
  created_by_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS research.project_ai_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES research.projects(id) ON DELETE CASCADE,
  input_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_text TEXT NOT NULL,
  created_by_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS research.vector_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES research.projects(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('project_document', 'project_ai_note', 'saved_item_caption')),
  source_id UUID NOT NULL,
  payload_text TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ NULL,
  error TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_scrape_jobs_org_created
ON research.scrape_jobs (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_scrape_jobs_org_status_created
ON research.scrape_jobs (organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_scrape_items_org_profile_posted
ON research.scrape_items (organization_id, profile_username, posted_at DESC);

CREATE INDEX IF NOT EXISTS idx_scrape_items_org_type
ON research.scrape_items (organization_id, type);

CREATE INDEX IF NOT EXISTS idx_scrape_items_job_created
ON research.scrape_items (scrape_job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_projects_org_status_updated
ON research.projects (organization_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_project_saved_items_project_created
ON research.project_saved_items (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_project_documents_project_updated
ON research.project_documents (project_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_project_ai_notes_project_created
ON research.project_ai_notes (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_vector_queue_org_status_created
ON research.vector_queue (organization_id, status, created_at ASC);

CREATE OR REPLACE FUNCTION research.validate_scrape_job_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = research, public
AS $$
BEGIN
  IF NOT public.is_org_member(NEW.created_by_user_id, NEW.organization_id) THEN
    RAISE EXCEPTION 'User % is not member of organization %', NEW.created_by_user_id, NEW.organization_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION research.validate_scrape_item_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = research, public
AS $$
DECLARE
  job_org_id UUID;
BEGIN
  SELECT sj.organization_id
  INTO job_org_id
  FROM research.scrape_jobs sj
  WHERE sj.id = NEW.scrape_job_id;

  IF job_org_id IS NULL THEN
    RAISE EXCEPTION 'Scrape job % does not exist', NEW.scrape_job_id
      USING ERRCODE = '23503';
  END IF;

  IF job_org_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'Scrape item organization mismatch for job %', NEW.scrape_job_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION research.validate_project_saved_item_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = research, public
AS $$
DECLARE
  project_org_id UUID;
  scrape_item_org_id UUID;
BEGIN
  SELECT p.organization_id
  INTO project_org_id
  FROM research.projects p
  WHERE p.id = NEW.project_id;

  IF project_org_id IS NULL THEN
    RAISE EXCEPTION 'Project % does not exist', NEW.project_id
      USING ERRCODE = '23503';
  END IF;

  SELECT si.organization_id
  INTO scrape_item_org_id
  FROM research.scrape_items si
  WHERE si.id = NEW.scrape_item_id;

  IF scrape_item_org_id IS NULL THEN
    RAISE EXCEPTION 'Scrape item % does not exist', NEW.scrape_item_id
      USING ERRCODE = '23503';
  END IF;

  IF project_org_id <> NEW.organization_id OR scrape_item_org_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'Project saved item organization mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF NOT public.is_org_member(NEW.selected_by_user_id, NEW.organization_id) THEN
    RAISE EXCEPTION 'User % is not member of organization %', NEW.selected_by_user_id, NEW.organization_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION research.validate_project_document_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = research, public
AS $$
DECLARE
  project_org_id UUID;
BEGIN
  SELECT p.organization_id
  INTO project_org_id
  FROM research.projects p
  WHERE p.id = NEW.project_id;

  IF project_org_id IS NULL THEN
    RAISE EXCEPTION 'Project % does not exist', NEW.project_id
      USING ERRCODE = '23503';
  END IF;

  IF project_org_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'Project document organization mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF NOT public.is_org_member(NEW.created_by_user_id, NEW.organization_id) THEN
    RAISE EXCEPTION 'User % is not member of organization %', NEW.created_by_user_id, NEW.organization_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION research.validate_project_ai_note_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = research, public
AS $$
DECLARE
  project_org_id UUID;
BEGIN
  SELECT p.organization_id
  INTO project_org_id
  FROM research.projects p
  WHERE p.id = NEW.project_id;

  IF project_org_id IS NULL THEN
    RAISE EXCEPTION 'Project % does not exist', NEW.project_id
      USING ERRCODE = '23503';
  END IF;

  IF project_org_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'Project AI note organization mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF NOT public.is_org_member(NEW.created_by_user_id, NEW.organization_id) THEN
    RAISE EXCEPTION 'User % is not member of organization %', NEW.created_by_user_id, NEW.organization_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION research.validate_vector_queue_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = research, public
AS $$
DECLARE
  project_org_id UUID;
BEGIN
  SELECT p.organization_id
  INTO project_org_id
  FROM research.projects p
  WHERE p.id = NEW.project_id;

  IF project_org_id IS NULL THEN
    RAISE EXCEPTION 'Project % does not exist', NEW.project_id
      USING ERRCODE = '23503';
  END IF;

  IF project_org_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'Vector queue organization mismatch'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_scrape_jobs_trigger ON research.scrape_jobs;
CREATE TRIGGER validate_scrape_jobs_trigger
BEFORE INSERT OR UPDATE ON research.scrape_jobs
FOR EACH ROW
EXECUTE FUNCTION research.validate_scrape_job_consistency();

DROP TRIGGER IF EXISTS validate_scrape_items_trigger ON research.scrape_items;
CREATE TRIGGER validate_scrape_items_trigger
BEFORE INSERT OR UPDATE ON research.scrape_items
FOR EACH ROW
EXECUTE FUNCTION research.validate_scrape_item_consistency();

DROP TRIGGER IF EXISTS validate_project_saved_items_trigger ON research.project_saved_items;
CREATE TRIGGER validate_project_saved_items_trigger
BEFORE INSERT OR UPDATE ON research.project_saved_items
FOR EACH ROW
EXECUTE FUNCTION research.validate_project_saved_item_consistency();

DROP TRIGGER IF EXISTS validate_project_documents_trigger ON research.project_documents;
CREATE TRIGGER validate_project_documents_trigger
BEFORE INSERT OR UPDATE ON research.project_documents
FOR EACH ROW
EXECUTE FUNCTION research.validate_project_document_consistency();

DROP TRIGGER IF EXISTS validate_project_ai_notes_trigger ON research.project_ai_notes;
CREATE TRIGGER validate_project_ai_notes_trigger
BEFORE INSERT OR UPDATE ON research.project_ai_notes
FOR EACH ROW
EXECUTE FUNCTION research.validate_project_ai_note_consistency();

DROP TRIGGER IF EXISTS validate_vector_queue_trigger ON research.vector_queue;
CREATE TRIGGER validate_vector_queue_trigger
BEFORE INSERT OR UPDATE ON research.vector_queue
FOR EACH ROW
EXECUTE FUNCTION research.validate_vector_queue_consistency();

DROP TRIGGER IF EXISTS update_scrape_jobs_updated_at ON research.scrape_jobs;
CREATE TRIGGER update_scrape_jobs_updated_at
BEFORE UPDATE ON research.scrape_jobs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_projects_updated_at ON research.projects;
CREATE TRIGGER update_projects_updated_at
BEFORE UPDATE ON research.projects
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_project_documents_updated_at ON research.project_documents;
CREATE TRIGGER update_project_documents_updated_at
BEFORE UPDATE ON research.project_documents
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE research.scrape_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE research.scrape_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE research.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE research.project_saved_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE research.project_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE research.project_ai_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE research.vector_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view scrape jobs" ON research.scrape_jobs;
CREATE POLICY "Org members can view scrape jobs"
ON research.scrape_jobs
FOR SELECT
USING (public.is_org_member(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Members can create scrape jobs" ON research.scrape_jobs;
CREATE POLICY "Members can create scrape jobs"
ON research.scrape_jobs
FOR INSERT
WITH CHECK (
  public.has_minimum_role(auth.uid(), organization_id, 'member'::public.user_role)
  AND created_by_user_id = auth.uid()
);

DROP POLICY IF EXISTS "Members can update scrape jobs" ON research.scrape_jobs;
CREATE POLICY "Members can update scrape jobs"
ON research.scrape_jobs
FOR UPDATE
USING (public.has_minimum_role(auth.uid(), organization_id, 'member'::public.user_role))
WITH CHECK (public.has_minimum_role(auth.uid(), organization_id, 'member'::public.user_role));

DROP POLICY IF EXISTS "Admins can delete scrape jobs" ON research.scrape_jobs;
CREATE POLICY "Admins can delete scrape jobs"
ON research.scrape_jobs
FOR DELETE
USING (public.has_minimum_role(auth.uid(), organization_id, 'admin'::public.user_role));

DROP POLICY IF EXISTS "Org members can view scrape items" ON research.scrape_items;
CREATE POLICY "Org members can view scrape items"
ON research.scrape_items
FOR SELECT
USING (public.is_org_member(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Members can create scrape items" ON research.scrape_items;
CREATE POLICY "Members can create scrape items"
ON research.scrape_items
FOR INSERT
WITH CHECK (public.has_minimum_role(auth.uid(), organization_id, 'member'::public.user_role));

DROP POLICY IF EXISTS "Members can update scrape items" ON research.scrape_items;
CREATE POLICY "Members can update scrape items"
ON research.scrape_items
FOR UPDATE
USING (public.has_minimum_role(auth.uid(), organization_id, 'member'::public.user_role))
WITH CHECK (public.has_minimum_role(auth.uid(), organization_id, 'member'::public.user_role));

DROP POLICY IF EXISTS "Admins can delete scrape items" ON research.scrape_items;
CREATE POLICY "Admins can delete scrape items"
ON research.scrape_items
FOR DELETE
USING (public.has_minimum_role(auth.uid(), organization_id, 'admin'::public.user_role));

DROP POLICY IF EXISTS "Org members can view projects" ON research.projects;
CREATE POLICY "Org members can view projects"
ON research.projects
FOR SELECT
USING (public.is_org_member(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Members can create projects" ON research.projects;
CREATE POLICY "Members can create projects"
ON research.projects
FOR INSERT
WITH CHECK (
  public.has_minimum_role(auth.uid(), organization_id, 'member'::public.user_role)
  AND created_by_user_id = auth.uid()
);

DROP POLICY IF EXISTS "Members can update projects" ON research.projects;
CREATE POLICY "Members can update projects"
ON research.projects
FOR UPDATE
USING (public.has_minimum_role(auth.uid(), organization_id, 'member'::public.user_role))
WITH CHECK (public.has_minimum_role(auth.uid(), organization_id, 'member'::public.user_role));

DROP POLICY IF EXISTS "Admins can delete projects" ON research.projects;
CREATE POLICY "Admins can delete projects"
ON research.projects
FOR DELETE
USING (public.has_minimum_role(auth.uid(), organization_id, 'admin'::public.user_role));

DROP POLICY IF EXISTS "Org members can view project saved items" ON research.project_saved_items;
CREATE POLICY "Org members can view project saved items"
ON research.project_saved_items
FOR SELECT
USING (public.is_org_member(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Members can create project saved items" ON research.project_saved_items;
CREATE POLICY "Members can create project saved items"
ON research.project_saved_items
FOR INSERT
WITH CHECK (
  public.has_minimum_role(auth.uid(), organization_id, 'member'::public.user_role)
  AND selected_by_user_id = auth.uid()
);

DROP POLICY IF EXISTS "Members can update project saved items" ON research.project_saved_items;
CREATE POLICY "Members can update project saved items"
ON research.project_saved_items
FOR UPDATE
USING (public.has_minimum_role(auth.uid(), organization_id, 'member'::public.user_role))
WITH CHECK (public.has_minimum_role(auth.uid(), organization_id, 'member'::public.user_role));

DROP POLICY IF EXISTS "Admins can delete project saved items" ON research.project_saved_items;
CREATE POLICY "Admins can delete project saved items"
ON research.project_saved_items
FOR DELETE
USING (public.has_minimum_role(auth.uid(), organization_id, 'admin'::public.user_role));

DROP POLICY IF EXISTS "Org members can view project documents" ON research.project_documents;
CREATE POLICY "Org members can view project documents"
ON research.project_documents
FOR SELECT
USING (public.is_org_member(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Members can create project documents" ON research.project_documents;
CREATE POLICY "Members can create project documents"
ON research.project_documents
FOR INSERT
WITH CHECK (
  public.has_minimum_role(auth.uid(), organization_id, 'member'::public.user_role)
  AND created_by_user_id = auth.uid()
);

DROP POLICY IF EXISTS "Members can update project documents" ON research.project_documents;
CREATE POLICY "Members can update project documents"
ON research.project_documents
FOR UPDATE
USING (public.has_minimum_role(auth.uid(), organization_id, 'member'::public.user_role))
WITH CHECK (public.has_minimum_role(auth.uid(), organization_id, 'member'::public.user_role));

DROP POLICY IF EXISTS "Admins can delete project documents" ON research.project_documents;
CREATE POLICY "Admins can delete project documents"
ON research.project_documents
FOR DELETE
USING (public.has_minimum_role(auth.uid(), organization_id, 'admin'::public.user_role));

DROP POLICY IF EXISTS "Org members can view project ai notes" ON research.project_ai_notes;
CREATE POLICY "Org members can view project ai notes"
ON research.project_ai_notes
FOR SELECT
USING (public.is_org_member(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Members can create project ai notes" ON research.project_ai_notes;
CREATE POLICY "Members can create project ai notes"
ON research.project_ai_notes
FOR INSERT
WITH CHECK (
  public.has_minimum_role(auth.uid(), organization_id, 'member'::public.user_role)
  AND created_by_user_id = auth.uid()
);

DROP POLICY IF EXISTS "Members can update project ai notes" ON research.project_ai_notes;
CREATE POLICY "Members can update project ai notes"
ON research.project_ai_notes
FOR UPDATE
USING (public.has_minimum_role(auth.uid(), organization_id, 'member'::public.user_role))
WITH CHECK (public.has_minimum_role(auth.uid(), organization_id, 'member'::public.user_role));

DROP POLICY IF EXISTS "Admins can delete project ai notes" ON research.project_ai_notes;
CREATE POLICY "Admins can delete project ai notes"
ON research.project_ai_notes
FOR DELETE
USING (public.has_minimum_role(auth.uid(), organization_id, 'admin'::public.user_role));

DROP POLICY IF EXISTS "Org members can view vector queue" ON research.vector_queue;
CREATE POLICY "Org members can view vector queue"
ON research.vector_queue
FOR SELECT
USING (public.is_org_member(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Members can create vector queue" ON research.vector_queue;
CREATE POLICY "Members can create vector queue"
ON research.vector_queue
FOR INSERT
WITH CHECK (public.has_minimum_role(auth.uid(), organization_id, 'member'::public.user_role));

DROP POLICY IF EXISTS "Members can update vector queue" ON research.vector_queue;
CREATE POLICY "Members can update vector queue"
ON research.vector_queue
FOR UPDATE
USING (public.has_minimum_role(auth.uid(), organization_id, 'member'::public.user_role))
WITH CHECK (public.has_minimum_role(auth.uid(), organization_id, 'member'::public.user_role));

DROP POLICY IF EXISTS "Admins can delete vector queue" ON research.vector_queue;
CREATE POLICY "Admins can delete vector queue"
ON research.vector_queue
FOR DELETE
USING (public.has_minimum_role(auth.uid(), organization_id, 'admin'::public.user_role));

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE research.scrape_jobs;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE research.scrape_items;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE research.projects;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;
END $$;
