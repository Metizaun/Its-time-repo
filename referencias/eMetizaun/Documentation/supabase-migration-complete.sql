-- =============================================
-- MIGRAÇÃO COMPLETA DO CRM PARA SUPABASE EXTERNO
-- Execute este script no SQL Editor do seu Supabase
-- =============================================

-- =============================================
-- PARTE 1: ENUM DE ROLES
-- =============================================
CREATE TYPE public.user_role AS ENUM ('owner', 'admin', 'member', 'viewer');

-- =============================================
-- PARTE 2: TABELAS CORE
-- =============================================

-- 2.1 Organizations (Tenants)
CREATE TABLE public.organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- 2.2 Profiles (Dados do usuário)
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE,
    display_name TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 2.3 User Roles (Permissões - NUNCA na tabela profiles!)
CREATE TABLE public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    role public.user_role NOT NULL DEFAULT 'member',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, organization_id)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- =============================================
-- PARTE 3: TABELAS CRM
-- =============================================

-- 3.1 Companies
CREATE TABLE public.companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    name TEXT NOT NULL,
    industry TEXT,
    website TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    city TEXT,
    state TEXT,
    country TEXT,
    postal_code TEXT,
    employee_count INTEGER,
    annual_revenue NUMERIC,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

-- 3.2 Contacts
CREATE TABLE public.contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    company TEXT,
    position TEXT,
    birthday DATE,
    anniversary DATE,
    important_dates JSONB,
    notes TEXT,
    personal_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

-- 3.3 Deals
CREATE TABLE public.deals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
    contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    value NUMERIC,
    stage TEXT NOT NULL DEFAULT 'Prospecting',
    status TEXT NOT NULL DEFAULT 'Prospecting',
    probability INTEGER DEFAULT 50,
    expected_close_date DATE,
    actual_close_date DATE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;

-- 3.4 Leads
CREATE TABLE public.leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    company TEXT,
    website TEXT,
    title TEXT,
    industry TEXT,
    location TEXT,
    source TEXT,
    status TEXT NOT NULL DEFAULT 'New',
    score INTEGER DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

-- 3.5 Lead Sources
CREATE TABLE public.lead_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.lead_sources ENABLE ROW LEVEL SECURITY;

-- 3.6 Lead Lists
CREATE TABLE public.lead_lists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    type TEXT NOT NULL DEFAULT 'static',
    criteria JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.lead_lists ENABLE ROW LEVEL SECURITY;

-- 3.7 Lead List Members
CREATE TABLE public.lead_list_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    list_id UUID NOT NULL REFERENCES public.lead_lists(id) ON DELETE CASCADE,
    lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
    added_by UUID NOT NULL,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(list_id, lead_id)
);
ALTER TABLE public.lead_list_members ENABLE ROW LEVEL SECURITY;

-- =============================================
-- PARTE 4: TABELAS OPERACIONAIS
-- =============================================

-- 4.1 Tasks
CREATE TABLE public.tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    assigned_to UUID,
    company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
    contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
    deal_id UUID REFERENCES public.deals(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'Pending',
    priority TEXT NOT NULL DEFAULT 'Medium',
    due_date DATE,
    completed_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

-- 4.2 Notes
CREATE TABLE public.notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
    contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    content TEXT,
    tags TEXT[],
    is_pinned BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;

-- 4.3 Notifications
CREATE TABLE public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'info',
    action_url TEXT,
    metadata JSONB,
    read BOOLEAN NOT NULL DEFAULT false,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- 4.4 Task Automation Rules
CREATE TABLE public.task_automation_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    trigger_type TEXT NOT NULL,
    trigger_conditions JSONB,
    task_template JSONB NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.task_automation_rules ENABLE ROW LEVEL SECURITY;

-- =============================================
-- PARTE 5: TABELAS DE PARCEIROS
-- =============================================

-- 5.1 Partners
CREATE TABLE public.partners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    name TEXT NOT NULL,
    company_name TEXT,
    contact_person TEXT,
    email TEXT,
    phone TEXT,
    website TEXT,
    industry TEXT,
    partnership_type TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    address TEXT,
    city TEXT,
    state TEXT,
    country TEXT,
    postal_code TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;

-- 5.2 Partner Contracts
CREATE TABLE public.partner_contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    partner_id UUID NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    contract_number TEXT,
    contract_type TEXT,
    description TEXT,
    contract_value NUMERIC,
    currency TEXT DEFAULT 'USD',
    start_date DATE,
    end_date DATE,
    renewal_date DATE,
    status TEXT NOT NULL DEFAULT 'draft',
    payment_terms TEXT,
    file_url TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.partner_contracts ENABLE ROW LEVEL SECURITY;

-- =============================================
-- PARTE 6: TABELAS DE CONTEÚDO E IA
-- =============================================

-- 6.1 Composer Templates
CREATE TABLE public.composer_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    name TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    content_type TEXT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.composer_templates ENABLE ROW LEVEL SECURITY;

-- 6.2 Composer Sequences
CREATE TABLE public.composer_sequences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    content_type TEXT NOT NULL,
    steps JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.composer_sequences ENABLE ROW LEVEL SECURITY;

-- 6.3 Knowledge Categories
CREATE TABLE public.knowledge_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.knowledge_categories ENABLE ROW LEVEL SECURITY;

-- 6.4 Knowledge Articles
CREATE TABLE public.knowledge_articles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    category_id UUID REFERENCES public.knowledge_categories(id) ON DELETE SET NULL,
    author_id UUID NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    tags TEXT[],
    is_published BOOLEAN NOT NULL DEFAULT true,
    view_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.knowledge_articles ENABLE ROW LEVEL SECURITY;

-- =============================================
-- PARTE 7: FUNÇÕES DE SEGURANÇA (SECURITY DEFINER)
-- =============================================

-- Verifica se usuário é membro de uma organização
CREATE OR REPLACE FUNCTION public.is_org_member(_user_id UUID, _organization_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND organization_id = _organization_id
  )
$$;

-- Obtém o role do usuário em uma organização
CREATE OR REPLACE FUNCTION public.get_user_role(user_uuid UUID, org_id UUID)
RETURNS public.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_roles 
  WHERE user_id = user_uuid AND organization_id = org_id;
$$;

-- Verifica se usuário tem pelo menos determinado nível de permissão
CREATE OR REPLACE FUNCTION public.has_minimum_role(user_uuid UUID, org_id UUID, min_role public.user_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE 
    WHEN min_role = 'viewer' THEN role IN ('viewer', 'member', 'admin', 'owner')
    WHEN min_role = 'member' THEN role IN ('member', 'admin', 'owner')
    WHEN min_role = 'admin' THEN role IN ('admin', 'owner')
    WHEN min_role = 'owner' THEN role = 'owner'
    ELSE FALSE
  END
  FROM public.user_roles 
  WHERE user_id = user_uuid AND organization_id = org_id;
$$;

-- =============================================
-- PARTE 8: POLÍTICAS RLS
-- =============================================

-- 8.1 Organizations
CREATE POLICY "Users can view organizations they belong to"
ON public.organizations FOR SELECT
USING (EXISTS (
  SELECT 1 FROM user_roles
  WHERE user_roles.user_id = auth.uid()
  AND user_roles.organization_id = organizations.id
));

CREATE POLICY "Admins and owners can update organizations"
ON public.organizations FOR UPDATE
USING (has_minimum_role(auth.uid(), id, 'admin'));

-- 8.2 Profiles
CREATE POLICY "Users can insert their own profile"
ON public.profiles FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own profile"
ON public.profiles FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can view profiles in their organizations"
ON public.profiles FOR SELECT
USING (
  auth.uid() = user_id OR
  EXISTS (
    SELECT 1 FROM user_roles ur1
    WHERE ur1.user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM user_roles ur2
      WHERE ur2.user_id = profiles.user_id
      AND ur2.organization_id = ur1.organization_id
    )
  )
);

-- 8.3 User Roles
CREATE POLICY "Users can view their own roles"
ON public.user_roles FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Organization members can view team roles"
ON public.user_roles FOR SELECT
USING (is_org_member(auth.uid(), organization_id));

CREATE POLICY "Users can manage roles in their organizations"
ON public.user_roles FOR INSERT
WITH CHECK (
  auth.uid() = user_id OR
  EXISTS (
    SELECT 1 FROM user_roles existing
    WHERE existing.user_id = auth.uid()
    AND existing.organization_id = user_roles.organization_id
    AND existing.role IN ('admin', 'owner')
  )
);

CREATE POLICY "Admins can update roles"
ON public.user_roles FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM user_roles existing
  WHERE existing.user_id = auth.uid()
  AND existing.organization_id = user_roles.organization_id
  AND existing.role IN ('admin', 'owner')
));

CREATE POLICY "Admins can delete roles"
ON public.user_roles FOR DELETE
USING (EXISTS (
  SELECT 1 FROM user_roles existing
  WHERE existing.user_id = auth.uid()
  AND existing.organization_id = user_roles.organization_id
  AND existing.role IN ('admin', 'owner')
));

-- 8.4 Companies
CREATE POLICY "Users can view companies in their organizations"
ON public.companies FOR SELECT
USING (EXISTS (
  SELECT 1 FROM user_roles
  WHERE user_roles.user_id = auth.uid()
  AND user_roles.organization_id = companies.organization_id
));

CREATE POLICY "Members and above can create companies"
ON public.companies FOR INSERT
WITH CHECK (has_minimum_role(auth.uid(), organization_id, 'member'));

CREATE POLICY "Members and above can update companies"
ON public.companies FOR UPDATE
USING (has_minimum_role(auth.uid(), organization_id, 'member'));

CREATE POLICY "Members and above can delete companies"
ON public.companies FOR DELETE
USING (has_minimum_role(auth.uid(), organization_id, 'member'));

-- 8.5 Contacts
CREATE POLICY "Users can view contacts in their organizations"
ON public.contacts FOR SELECT
USING (EXISTS (
  SELECT 1 FROM user_roles
  WHERE user_roles.user_id = auth.uid()
  AND user_roles.organization_id = contacts.organization_id
));

CREATE POLICY "Members and above can create contacts"
ON public.contacts FOR INSERT
WITH CHECK (has_minimum_role(auth.uid(), organization_id, 'member'));

CREATE POLICY "Members and above can update contacts"
ON public.contacts FOR UPDATE
USING (has_minimum_role(auth.uid(), organization_id, 'member'));

CREATE POLICY "Members and above can delete contacts"
ON public.contacts FOR DELETE
USING (has_minimum_role(auth.uid(), organization_id, 'member'));

-- 8.6 Deals
CREATE POLICY "Users can view deals in their organizations"
ON public.deals FOR SELECT
USING (EXISTS (
  SELECT 1 FROM user_roles
  WHERE user_roles.user_id = auth.uid()
  AND user_roles.organization_id = deals.organization_id
));

CREATE POLICY "Members and above can create deals"
ON public.deals FOR INSERT
WITH CHECK (has_minimum_role(auth.uid(), organization_id, 'member'));

CREATE POLICY "Members and above can update deals"
ON public.deals FOR UPDATE
USING (has_minimum_role(auth.uid(), organization_id, 'member'));

CREATE POLICY "Members and above can delete deals"
ON public.deals FOR DELETE
USING (has_minimum_role(auth.uid(), organization_id, 'member'));

-- 8.7 Leads
CREATE POLICY "Users can view leads in their organizations"
ON public.leads FOR SELECT
USING (EXISTS (
  SELECT 1 FROM user_roles
  WHERE user_roles.user_id = auth.uid()
  AND user_roles.organization_id = leads.organization_id
));

CREATE POLICY "Members and above can create leads"
ON public.leads FOR INSERT
WITH CHECK (has_minimum_role(auth.uid(), organization_id, 'member'));

CREATE POLICY "Members and above can update leads"
ON public.leads FOR UPDATE
USING (has_minimum_role(auth.uid(), organization_id, 'member'));

CREATE POLICY "Members and above can delete leads"
ON public.leads FOR DELETE
USING (has_minimum_role(auth.uid(), organization_id, 'member'));

-- 8.8 Lead Sources
CREATE POLICY "Users can view lead sources in their organizations"
ON public.lead_sources FOR SELECT
USING (EXISTS (
  SELECT 1 FROM user_roles
  WHERE user_roles.user_id = auth.uid()
  AND user_roles.organization_id = lead_sources.organization_id
));

CREATE POLICY "Members and above can manage lead sources"
ON public.lead_sources FOR ALL
USING (has_minimum_role(auth.uid(), organization_id, 'member'));

-- 8.9 Lead Lists
CREATE POLICY "Users can view lead lists in their organizations"
ON public.lead_lists FOR SELECT
USING (EXISTS (
  SELECT 1 FROM user_roles
  WHERE user_roles.user_id = auth.uid()
  AND user_roles.organization_id = lead_lists.organization_id
));

CREATE POLICY "Members and above can create lead lists"
ON public.lead_lists FOR INSERT
WITH CHECK (has_minimum_role(auth.uid(), organization_id, 'member'));

CREATE POLICY "Members and above can update lead lists"
ON public.lead_lists FOR UPDATE
USING (has_minimum_role(auth.uid(), organization_id, 'member'));

CREATE POLICY "Members and above can delete lead lists"
ON public.lead_lists FOR DELETE
USING (has_minimum_role(auth.uid(), organization_id, 'member'));

-- 8.10 Lead List Members
CREATE POLICY "Users can view lead list members in their organizations"
ON public.lead_list_members FOR SELECT
USING (EXISTS (
  SELECT 1 FROM lead_lists
  JOIN user_roles ON user_roles.organization_id = lead_lists.organization_id
  WHERE lead_lists.id = lead_list_members.list_id
  AND user_roles.user_id = auth.uid()
));

CREATE POLICY "Members and above can manage lead list members"
ON public.lead_list_members FOR ALL
USING (EXISTS (
  SELECT 1 FROM lead_lists
  WHERE lead_lists.id = lead_list_members.list_id
  AND has_minimum_role(auth.uid(), lead_lists.organization_id, 'member')
));

-- 8.11 Tasks
CREATE POLICY "Users can view tasks in their organizations"
ON public.tasks FOR SELECT
USING (EXISTS (
  SELECT 1 FROM user_roles
  WHERE user_roles.user_id = auth.uid()
  AND user_roles.organization_id = tasks.organization_id
));

CREATE POLICY "Members and above can create tasks"
ON public.tasks FOR INSERT
WITH CHECK (has_minimum_role(auth.uid(), organization_id, 'member'));

CREATE POLICY "Members and above can update tasks"
ON public.tasks FOR UPDATE
USING (has_minimum_role(auth.uid(), organization_id, 'member'));

CREATE POLICY "Members and above can delete tasks"
ON public.tasks FOR DELETE
USING (has_minimum_role(auth.uid(), organization_id, 'member'));

-- 8.12 Notes
CREATE POLICY "Users can view notes in their organizations"
ON public.notes FOR SELECT
USING (EXISTS (
  SELECT 1 FROM user_roles
  WHERE user_roles.user_id = auth.uid()
  AND user_roles.organization_id = notes.organization_id
));

CREATE POLICY "Members and above can create notes"
ON public.notes FOR INSERT
WITH CHECK (has_minimum_role(auth.uid(), organization_id, 'member'));

CREATE POLICY "Members and above can update notes"
ON public.notes FOR UPDATE
USING (has_minimum_role(auth.uid(), organization_id, 'member'));

CREATE POLICY "Members and above can delete notes"
ON public.notes FOR DELETE
USING (has_minimum_role(auth.uid(), organization_id, 'member'));

-- 8.13 Notifications
CREATE POLICY "Users can view their own notifications"
ON public.notifications FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own notifications"
ON public.notifications FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own notifications"
ON public.notifications FOR DELETE
USING (auth.uid() = user_id);

CREATE POLICY "System can create notifications for users"
ON public.notifications FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM user_roles
  WHERE user_roles.user_id = auth.uid()
  AND user_roles.organization_id = notifications.organization_id
));

-- 8.14 Task Automation Rules
CREATE POLICY "Users can view automation rules in their organizations"
ON public.task_automation_rules FOR SELECT
USING (EXISTS (
  SELECT 1 FROM user_roles
  WHERE user_roles.user_id = auth.uid()
  AND user_roles.organization_id = task_automation_rules.organization_id
));

CREATE POLICY "Members and above can create automation rules"
ON public.task_automation_rules FOR INSERT
WITH CHECK (has_minimum_role(auth.uid(), organization_id, 'member'));

CREATE POLICY "Members and above can update automation rules"
ON public.task_automation_rules FOR UPDATE
USING (has_minimum_role(auth.uid(), organization_id, 'member'));

CREATE POLICY "Members and above can delete automation rules"
ON public.task_automation_rules FOR DELETE
USING (has_minimum_role(auth.uid(), organization_id, 'member'));

-- 8.15 Partners
CREATE POLICY "Users can view partners in their organizations"
ON public.partners FOR SELECT
USING (EXISTS (
  SELECT 1 FROM user_roles
  WHERE user_roles.user_id = auth.uid()
  AND user_roles.organization_id = partners.organization_id
));

CREATE POLICY "Members and above can create partners"
ON public.partners FOR INSERT
WITH CHECK (has_minimum_role(auth.uid(), organization_id, 'member'));

CREATE POLICY "Members and above can update partners"
ON public.partners FOR UPDATE
USING (has_minimum_role(auth.uid(), organization_id, 'member'));

CREATE POLICY "Members and above can delete partners"
ON public.partners FOR DELETE
USING (has_minimum_role(auth.uid(), organization_id, 'member'));

-- 8.16 Partner Contracts
CREATE POLICY "Users can view partner contracts in their organizations"
ON public.partner_contracts FOR SELECT
USING (EXISTS (
  SELECT 1 FROM user_roles
  WHERE user_roles.user_id = auth.uid()
  AND user_roles.organization_id = partner_contracts.organization_id
));

CREATE POLICY "Members and above can create partner contracts"
ON public.partner_contracts FOR INSERT
WITH CHECK (has_minimum_role(auth.uid(), organization_id, 'member'));

CREATE POLICY "Members and above can update partner contracts"
ON public.partner_contracts FOR UPDATE
USING (has_minimum_role(auth.uid(), organization_id, 'member'));

CREATE POLICY "Members and above can delete partner contracts"
ON public.partner_contracts FOR DELETE
USING (has_minimum_role(auth.uid(), organization_id, 'member'));

-- 8.17 Composer Templates
CREATE POLICY "Users can view templates in their organizations"
ON public.composer_templates FOR SELECT
USING (EXISTS (
  SELECT 1 FROM user_roles
  WHERE user_roles.user_id = auth.uid()
  AND user_roles.organization_id = composer_templates.organization_id
));

CREATE POLICY "Members and above can create templates"
ON public.composer_templates FOR INSERT
WITH CHECK (has_minimum_role(auth.uid(), organization_id, 'member'));

CREATE POLICY "Members and above can update templates"
ON public.composer_templates FOR UPDATE
USING (has_minimum_role(auth.uid(), organization_id, 'member'));

CREATE POLICY "Members and above can delete templates"
ON public.composer_templates FOR DELETE
USING (has_minimum_role(auth.uid(), organization_id, 'member'));

-- 8.18 Composer Sequences
CREATE POLICY "Users can view sequences in their organizations"
ON public.composer_sequences FOR SELECT
USING (EXISTS (
  SELECT 1 FROM user_roles
  WHERE user_roles.user_id = auth.uid()
  AND user_roles.organization_id = composer_sequences.organization_id
));

CREATE POLICY "Members and above can create sequences"
ON public.composer_sequences FOR INSERT
WITH CHECK (has_minimum_role(auth.uid(), organization_id, 'member'));

CREATE POLICY "Members and above can update sequences"
ON public.composer_sequences FOR UPDATE
USING (has_minimum_role(auth.uid(), organization_id, 'member'));

CREATE POLICY "Members and above can delete sequences"
ON public.composer_sequences FOR DELETE
USING (has_minimum_role(auth.uid(), organization_id, 'member'));

-- 8.19 Knowledge Categories
CREATE POLICY "Users can view categories in their organizations"
ON public.knowledge_categories FOR SELECT
USING (EXISTS (
  SELECT 1 FROM user_roles
  WHERE user_roles.user_id = auth.uid()
  AND user_roles.organization_id = knowledge_categories.organization_id
));

CREATE POLICY "Members and above can create categories"
ON public.knowledge_categories FOR INSERT
WITH CHECK (has_minimum_role(auth.uid(), organization_id, 'member'));

CREATE POLICY "Members and above can update categories"
ON public.knowledge_categories FOR UPDATE
USING (has_minimum_role(auth.uid(), organization_id, 'member'));

CREATE POLICY "Members and above can delete categories"
ON public.knowledge_categories FOR DELETE
USING (has_minimum_role(auth.uid(), organization_id, 'member'));

-- 8.20 Knowledge Articles
CREATE POLICY "Users can view published articles in their organizations"
ON public.knowledge_articles FOR SELECT
USING (
  is_published = true AND
  EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = auth.uid()
    AND user_roles.organization_id = knowledge_articles.organization_id
  )
);

CREATE POLICY "Members and above can create articles"
ON public.knowledge_articles FOR INSERT
WITH CHECK (has_minimum_role(auth.uid(), organization_id, 'member'));

CREATE POLICY "Members and above can update articles"
ON public.knowledge_articles FOR UPDATE
USING (has_minimum_role(auth.uid(), organization_id, 'member'));

CREATE POLICY "Members and above can delete articles"
ON public.knowledge_articles FOR DELETE
USING (has_minimum_role(auth.uid(), organization_id, 'member'));

-- =============================================
-- PARTE 9: TRIGGER PARA UPDATED_AT
-- =============================================

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Aplicar triggers em todas as tabelas com updated_at
CREATE TRIGGER update_organizations_updated_at BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_user_roles_updated_at BEFORE UPDATE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_companies_updated_at BEFORE UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_contacts_updated_at BEFORE UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_deals_updated_at BEFORE UPDATE ON public.deals FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_leads_updated_at BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_lead_sources_updated_at BEFORE UPDATE ON public.lead_sources FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_lead_lists_updated_at BEFORE UPDATE ON public.lead_lists FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_notes_updated_at BEFORE UPDATE ON public.notes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_task_automation_rules_updated_at BEFORE UPDATE ON public.task_automation_rules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_partners_updated_at BEFORE UPDATE ON public.partners FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_partner_contracts_updated_at BEFORE UPDATE ON public.partner_contracts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_composer_templates_updated_at BEFORE UPDATE ON public.composer_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_composer_sequences_updated_at BEFORE UPDATE ON public.composer_sequences FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_knowledge_categories_updated_at BEFORE UPDATE ON public.knowledge_categories FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_knowledge_articles_updated_at BEFORE UPDATE ON public.knowledge_articles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- PARTE 10: TRIGGER PARA NOVO USUÁRIO
-- =============================================

CREATE OR REPLACE FUNCTION public.handle_new_user_conditional()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_org_id uuid;
  skip_personal boolean;
BEGIN
  -- Sempre cria/atualiza perfil
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, NEW.raw_user_meta_data ->> 'display_name')
  ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name;

  -- Verifica se deve pular criação de org pessoal (usuários convidados)
  skip_personal := COALESCE((NEW.raw_user_meta_data ->> 'skip_personal_org')::boolean, false)
                   OR (NEW.raw_user_meta_data ? 'invited_organization_id');
  IF skip_personal THEN
    RETURN NEW;
  END IF;

  -- Cria organização pessoal se usuário não tiver nenhuma
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = NEW.id
  ) THEN
    INSERT INTO public.organizations (name)
    VALUES (COALESCE(NEW.raw_user_meta_data ->> 'display_name', 'My Organization') || '''s CRM')
    RETURNING id INTO new_org_id;

    INSERT INTO public.user_roles (user_id, organization_id, role)
    VALUES (NEW.id, new_org_id, 'owner');
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger no auth.users
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_conditional();

-- =============================================
-- PARTE 11: STORAGE BUCKETS
-- =============================================

-- Bucket para avatares (público)
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Bucket para contratos de parceiros (privado)
INSERT INTO storage.buckets (id, name, public)
VALUES ('partner-contracts', 'partner-contracts', false)
ON CONFLICT (id) DO NOTHING;

-- Políticas de storage para avatars
CREATE POLICY "Avatar images are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'avatars');

CREATE POLICY "Anyone can upload an avatar"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'avatars');

CREATE POLICY "Users can update their own avatar"
ON storage.objects FOR UPDATE
USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Políticas para partner-contracts
CREATE POLICY "Authenticated users can view contracts"
ON storage.objects FOR SELECT
USING (bucket_id = 'partner-contracts' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can upload contracts"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'partner-contracts' AND auth.role() = 'authenticated');

-- =============================================
-- FIM DA MIGRAÇÃO
-- =============================================
-- Após executar este script, conecte seu projeto Supabase ao Lovable:
-- Settings > Connectors > Supabase
-- Cole a URL e Anon Key do seu projeto externo
