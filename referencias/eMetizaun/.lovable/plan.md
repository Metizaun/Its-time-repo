

# Plano de Migração: Configuração Completa do Banco de Dados Supabase

Este plano contém todos os scripts SQL necessários para configurar o banco de dados do CRM no seu projeto Supabase externo, organizados em ordem de execução.

---

## Visão Geral da Arquitetura

O sistema utiliza um modelo **multi-tenant** baseado em organizações:
- Cada usuário pode pertencer a múltiplas organizações
- Permissões são controladas por roles (owner, admin, member, viewer)
- Row Level Security (RLS) garante isolamento de dados entre organizações

---

## Parte 1: Tipos e Enums

Execute primeiro para criar os tipos base do sistema.

```text
-- =============================================
-- PARTE 1: CRIAÇÃO DO ENUM DE ROLES
-- =============================================
-- Este enum define os níveis de permissão no sistema
-- owner: Controle total da organização
-- admin: Pode gerenciar usuários e configurações
-- member: Pode criar/editar dados
-- viewer: Apenas visualização

CREATE TYPE public.user_role AS ENUM ('owner', 'admin', 'member', 'viewer');
```

---

## Parte 2: Tabelas Core (Autenticação e Multi-tenancy)

Estas são as tabelas fundamentais do sistema. **EXECUTE NA ORDEM APRESENTADA.**

### 2.1 Tabela: organizations
```text
-- Armazena as organizações/empresas (tenants)
CREATE TABLE public.organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
```

### 2.2 Tabela: profiles
```text
-- Perfis dos usuários (dados adicionais além do auth.users)
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE,
    display_name TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
```

### 2.3 Tabela: user_roles
```text
-- Relaciona usuários com organizações e suas permissões
-- CRÍTICO: Roles NUNCA devem estar na tabela profiles
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
```

---

## Parte 3: Tabelas CRM (Vendas e Contatos)

### 3.1 Tabela: companies
```text
-- Empresas clientes
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
```

### 3.2 Tabela: contacts
```text
-- Pessoas de contato
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
```

### 3.3 Tabela: deals
```text
-- Negócios/Oportunidades de venda
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
```

### 3.4 Tabela: leads
```text
-- Potenciais clientes
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
```

### 3.5 Tabela: lead_sources
```text
-- Origem dos leads (Google, Indicação, etc.)
CREATE TABLE public.lead_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.lead_sources ENABLE ROW LEVEL SECURITY;
```

### 3.6 Tabela: lead_lists
```text
-- Listas de segmentação de leads
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
```

### 3.7 Tabela: lead_list_members
```text
-- Relaciona leads com listas (tabela de junção)
CREATE TABLE public.lead_list_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    list_id UUID NOT NULL REFERENCES public.lead_lists(id) ON DELETE CASCADE,
    lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
    added_by UUID NOT NULL,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(list_id, lead_id)
);

ALTER TABLE public.lead_list_members ENABLE ROW LEVEL SECURITY;
```

---

## Parte 4: Tabelas Operacionais

### 4.1 Tabela: tasks
```text
-- Tarefas a fazer
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
```

### 4.2 Tabela: notes
```text
-- Anotações gerais
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
```

### 4.3 Tabela: notifications
```text
-- Sistema de notificações
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
```

### 4.4 Tabela: task_automation_rules
```text
-- Regras de automação de tarefas
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
```

---

## Parte 5: Tabelas de Parceiros

### 5.1 Tabela: partners
```text
-- Parceiros de negócios
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
```

### 5.2 Tabela: partner_contracts
```text
-- Contratos de parceiros
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
```

---

## Parte 6: Tabelas de Conteúdo e IA

### 6.1 Tabela: composer_templates
```text
-- Modelos de texto para o compositor
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
```

### 6.2 Tabela: composer_sequences
```text
-- Sequências de automação
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
```

### 6.3 Tabela: knowledge_categories
```text
-- Categorias da base de conhecimento
CREATE TABLE public.knowledge_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.knowledge_categories ENABLE ROW LEVEL SECURITY;
```

### 6.4 Tabela: knowledge_articles
```text
-- Artigos da base de conhecimento
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
```

---

## Parte 7: Funções de Segurança (SECURITY DEFINER)

**CRÍTICO:** Estas funções evitam recursão infinita nas políticas RLS.

```text
-- =============================================
-- FUNÇÕES DE SEGURANÇA
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
```

---

## Parte 8: Políticas RLS (Row Level Security)

### 8.1 Políticas para organizations
```text
-- Organizations: apenas membros podem visualizar
CREATE POLICY "Users can view organizations they belong to"
ON public.organizations FOR SELECT
USING (EXISTS (
  SELECT 1 FROM user_roles
  WHERE user_roles.user_id = auth.uid()
  AND user_roles.organization_id = organizations.id
));

-- Apenas admin/owner podem atualizar
CREATE POLICY "Admins and owners can update organizations"
ON public.organizations FOR UPDATE
USING (has_minimum_role(auth.uid(), id, 'admin'));
```

### 8.2 Políticas para profiles
```text
-- Perfis: usuário pode ver e editar seu próprio perfil
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
```

### 8.3 Políticas para user_roles
```text
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
```

### 8.4 Template para tabelas de dados (aplicar em todas)

O padrão abaixo se aplica a: `companies`, `contacts`, `deals`, `leads`, `lead_sources`, `lead_lists`, `tasks`, `notes`, `task_automation_rules`, `partners`, `partner_contracts`, `composer_templates`, `composer_sequences`, `knowledge_categories`.

```text
-- Substituir [TABELA] pelo nome da tabela

-- SELECT: membros da organização podem visualizar
CREATE POLICY "Users can view [TABELA] in their organizations"
ON public.[TABELA] FOR SELECT
USING (EXISTS (
  SELECT 1 FROM user_roles
  WHERE user_roles.user_id = auth.uid()
  AND user_roles.organization_id = [TABELA].organization_id
));

-- INSERT: member ou superior pode criar
CREATE POLICY "Members and above can create [TABELA]"
ON public.[TABELA] FOR INSERT
WITH CHECK (has_minimum_role(auth.uid(), organization_id, 'member'));

-- UPDATE: member ou superior pode editar
CREATE POLICY "Members and above can update [TABELA]"
ON public.[TABELA] FOR UPDATE
USING (has_minimum_role(auth.uid(), organization_id, 'member'));

-- DELETE: member ou superior pode deletar
CREATE POLICY "Members and above can delete [TABELA]"
ON public.[TABELA] FOR DELETE
USING (has_minimum_role(auth.uid(), organization_id, 'member'));
```

### 8.5 Políticas específicas para lead_list_members
```text
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
```

### 8.6 Políticas para notifications
```text
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
```

### 8.7 Políticas para knowledge_articles
```text
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
```

---

## Parte 9: Trigger para updated_at
```text
-- Função genérica para atualizar updated_at
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

-- Aplicar em todas as tabelas com updated_at
-- Exemplo para companies (repetir para todas as tabelas):
CREATE TRIGGER update_companies_updated_at
  BEFORE UPDATE ON public.companies
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
```

---

## Parte 10: Trigger para criar perfil e organização automaticamente

```text
-- Cria perfil e organização quando novo usuário se cadastra
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

-- Trigger no auth.users (executar no SQL Editor do Supabase)
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_conditional();
```

---

## Parte 11: Storage Buckets

Execute no SQL Editor do Supabase:

```text
-- Bucket para avatares (público)
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true);

-- Bucket para contratos de parceiros (privado)
INSERT INTO storage.buckets (id, name, public)
VALUES ('partner-contracts', 'partner-contracts', false);

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

-- Políticas para partner-contracts (usuários autenticados da org)
CREATE POLICY "Authenticated users can view contracts"
ON storage.objects FOR SELECT
USING (bucket_id = 'partner-contracts' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can upload contracts"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'partner-contracts' AND auth.role() = 'authenticated');
```

---

## Parte 12: Configuração no Código

Após criar as tabelas, você precisará:

1. **Conectar seu projeto Supabase ao Lovable:**
   - Vá em Settings > Connectors > Supabase
   - Cole sua URL e Anon Key do projeto externo

2. **Regenerar os tipos TypeScript:**
   - O Lovable vai regenerar `src/integrations/supabase/types.ts` automaticamente

---

## Resumo das 20 Tabelas

| # | Tabela | Propósito |
|---|--------|-----------|
| 1 | organizations | Empresas/Tenants |
| 2 | profiles | Dados de perfil do usuário |
| 3 | user_roles | Permissões (owner/admin/member/viewer) |
| 4 | companies | Empresas clientes |
| 5 | contacts | Pessoas de contato |
| 6 | deals | Negócios/Oportunidades |
| 7 | leads | Potenciais clientes |
| 8 | lead_sources | Origem dos leads |
| 9 | lead_lists | Listas de segmentação |
| 10 | lead_list_members | Leads em listas |
| 11 | tasks | Tarefas |
| 12 | notes | Anotações |
| 13 | notifications | Notificações |
| 14 | task_automation_rules | Regras de automação |
| 15 | partners | Parceiros de negócios |
| 16 | partner_contracts | Contratos |
| 17 | composer_templates | Modelos de texto |
| 18 | composer_sequences | Sequências de automação |
| 19 | knowledge_categories | Categorias de conhecimento |
| 20 | knowledge_articles | Artigos de conhecimento |

---

## Ordem de Execução Recomendada

1. Criar o enum `user_role`
2. Criar tabelas na ordem apresentada (respeitar foreign keys)
3. Criar funções de segurança
4. Criar políticas RLS
5. Criar triggers
6. Configurar storage buckets
7. Conectar o Supabase externo ao Lovable

