# Supabase RLS Best Practices - SuperBro CRM Implementation Guide

## Executive Summary

This document establishes definitive RLS architecture standards for the SuperBro CRM system, based on official Supabase best practices and the specific requirements of a multi-tenant B2B CRM platform. These standards ensure **consistent, performant, and secure** database access patterns across all tables while supporting complex organizational hierarchies and role-based permissions.

## 🎯 Core Principles for SuperBro CRM

### 1. **Separation of Concerns: RLS for "Who", Application for "What"**

Your RLS policies should only ever answer the question: **"Who can access this row?"**. Business logic filtering—the "what"—belongs in your application code.

```sql
-- ✅ RLS HANDLES: WHO can access data (Security)
USING (
  -- Is the user the owner of this record?
  user_id = auth.uid() OR
  -- Does the user have access through organization membership?
  organization_id IN (
    SELECT organization_id FROM user_roles 
    WHERE user_id = auth.uid() AND role IN ('member', 'admin', 'owner')
  )
)

-- ✅ APPLICATION HANDLES: WHAT data they see (Business Logic)  
.eq('status', 'active')           -- Business filtering
.gte('deal_value', 1000)          -- Business filtering
.order('created_at', { ascending: false })  -- Sorting
```

### 1.1 **CRM-Specific Access Patterns**

SuperBro CRM has unique multi-tenant access patterns with organization-based data isolation:

```sql
-- ✅ ORGANIZATION MEMBER ACCESS: Can view data within their organization
USING (
  organization_id IN (
    SELECT organization_id FROM user_roles 
    WHERE user_id = auth.uid() AND role IN ('viewer', 'member', 'admin', 'owner')
  )
)

-- ✅ PERSONAL DATA ACCESS: Can view their own records + organization records
USING (
  user_id = auth.uid() OR
  organization_id IN (
    SELECT organization_id FROM user_roles 
    WHERE user_id = auth.uid()
  )
)

-- ✅ ROLE-BASED ACCESS: Different permissions based on role hierarchy
USING (
  EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_id = auth.uid() 
    AND organization_id = companies.organization_id
    AND role IN ('admin', 'owner')
  )
)
```

### 2. **Single Source of Truth for Roles - User Roles Table**

All role verification must go through the `user_roles` table and helper functions. This prevents logic drift and supports SuperBro's organizational role hierarchies.

```sql
-- ✅ ALL role verification through helper functions
USING (public.has_minimum_role(auth.uid(), organization_id, 'member'))
USING (public.is_organization_member(auth.uid(), organization_id))
USING (public.is_organization_admin(auth.uid(), organization_id))

-- ✅ GOOD: Direct user_roles table access for simple checks
USING (
  EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_id = auth.uid() 
    AND organization_id = companies.organization_id
    AND role IN ('member', 'admin', 'owner')
  )
)

-- ❌ NEVER use auth.jwt() metadata for security decisions
-- This can be manipulated client-side and is unreliable
USING ((auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' = 'admin') -- WRONG
```

### 2.1 **SuperBro Role Hierarchy - Performance Optimized Functions**

```sql
-- ✅ OPTIMIZED: Use SQL functions for better performance and caching
CREATE OR REPLACE FUNCTION public.is_organization_member(p_user_id uuid, p_organization_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = p_user_id 
    AND organization_id = p_organization_id
    AND role IN ('viewer', 'member', 'admin', 'owner')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_organization_admin(p_user_id uuid, p_organization_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = p_user_id 
    AND organization_id = p_organization_id
    AND role IN ('admin', 'owner')
  );
$$;

CREATE OR REPLACE FUNCTION public.get_user_organizations(p_user_id uuid)
RETURNS TABLE(organization_id uuid, role user_role)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT ur.organization_id, ur.role
  FROM public.user_roles ur
  WHERE ur.user_id = p_user_id;
$$;

-- ✅ ENHANCED: Updated function that matches current schema
CREATE OR REPLACE FUNCTION public.has_minimum_role(
  p_user_id uuid, 
  p_organization_id uuid, 
  p_min_role user_role
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT CASE 
    WHEN p_min_role = 'viewer' THEN role IN ('viewer', 'member', 'admin', 'owner')
    WHEN p_min_role = 'member' THEN role IN ('member', 'admin', 'owner')
    WHEN p_min_role = 'admin' THEN role IN ('admin', 'owner')
    WHEN p_min_role = 'owner' THEN role = 'owner'
    ELSE FALSE
  END
  FROM public.user_roles 
  WHERE user_id = p_user_id AND organization_id = p_organization_id;
$$;
```

### 3. **Database-Level Ownership Protection**

Enforce data ownership at the database level using `user_id = auth.uid()` and organization membership. Application-level checks can be bypassed; database RLS cannot.

```sql
-- ✅ Direct ownership checks for personal data
USING (user_id = auth.uid()) -- Direct column check

-- ✅ Organization-level ownership for shared data
USING (
  organization_id IN (
    SELECT organization_id FROM user_roles WHERE user_id = auth.uid()
  )
)

-- ❌ NEVER rely on application-only ownership checks
-- An attacker can bypass the UI/API and query the database directly.
```

## 📋 Standard RLS Policy Patterns for SuperBro CRM

### Pattern 1: User Owns Personal Data + Organization Access

This is the most common pattern for CRM data (contacts, companies, deals, tasks).

```sql
-- Personal + organizational data access
CREATE POLICY "user_and_org_access_[table_name]"
ON [table_name] FOR SELECT TO authenticated
USING (
  user_id = auth.uid() OR
  organization_id IN (
    SELECT organization_id FROM user_roles 
    WHERE user_id = auth.uid()
  )
);

-- Only allow creation with proper user_id and organization_id validation
CREATE POLICY "user_create_own_[table_name]"
ON [table_name] FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid() AND
  (
    organization_id IS NULL OR
    organization_id IN (
      SELECT organization_id FROM user_roles 
      WHERE user_id = auth.uid()
    )
  )
);

-- Only allow updates to own records or organization records with permissions
CREATE POLICY "user_update_accessible_[table_name]"
ON [table_name] FOR UPDATE TO authenticated
USING (
  user_id = auth.uid() OR
  (
    organization_id IN (
      SELECT organization_id FROM user_roles 
      WHERE user_id = auth.uid() AND role IN ('member', 'admin', 'owner')
    )
  )
);

-- Only allow deletion of own records or admin/owner permissions
CREATE POLICY "user_delete_accessible_[table_name]"
ON [table_name] FOR DELETE TO authenticated
USING (
  user_id = auth.uid() OR
  (
    organization_id IN (
      SELECT organization_id FROM user_roles 
      WHERE user_id = auth.uid() AND role IN ('admin', 'owner')
    )
  )
);
```

### Pattern 2: Organization-Level Data Management

For data that belongs to the organization as a whole (lead sources, automation rules).

```sql
-- Organization members can read organization data
CREATE POLICY "org_members_read_[table_name]"
ON [table_name] FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_id = auth.uid() 
    AND organization_id = [table_name].organization_id
  )
);

-- Members and above can create/update/delete organization data
CREATE POLICY "org_members_manage_[table_name]"
ON [table_name] FOR ALL TO authenticated
USING (has_minimum_role(auth.uid(), organization_id, 'member'))
WITH CHECK (has_minimum_role(auth.uid(), organization_id, 'member'));
```

### Pattern 3: Admin-Only Organization Management

For sensitive organization settings and user role management.

```sql
-- Only admins and owners can manage organization settings
CREATE POLICY "org_admin_manage_[table_name]"
ON [table_name] FOR ALL TO authenticated
USING (has_minimum_role(auth.uid(), organization_id, 'admin'))
WITH CHECK (has_minimum_role(auth.uid(), organization_id, 'admin'));
```

### Pattern 4: Service Role Full Access

For backend processes, migrations, and Edge Functions that need to bypass RLS.

```sql
-- Service role for trusted backend operations
CREATE POLICY "service_role_full_access_[table_name]"
ON [table_name] FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
```

## 🛡️ Service Role Usage Guidelines

**✅ Service Role Should Be Used For:**
- Database migrations and schema changes
- Background jobs and scheduled tasks (task automation)
- Edge Functions performing admin operations
- System-level data operations (analytics, reporting)
- Data seeding during deployment
- Cross-organization data operations

**❌ Service Role Should NEVER Be Used For:**
- Client-side code or frontend applications
- Public APIs accessible to end users
- User-facing operations that should respect permissions
- Operations that could be done with authenticated user context

**🔒 Service Role Security Requirements:**
- Never expose `service_role` key in client-side code
- Only use in server-side environments (Edge Functions, backend services)
- Store service role key as environment variable, never in code
- Audit all service role usage and limit to specific operations

```sql
-- ✅ CORRECT: Use service role in Edge Functions for admin tasks
-- In an Edge Function:
const supabaseAdmin = createClient(url, service_role_key);
await supabaseAdmin.from('task_automation_rules').update({ enabled: false });

-- ❌ WRONG: Never expose in frontend
const supabase = createClient(url, service_role_key); // DON'T DO THIS
```

## 🚫 Anti-Patterns to Avoid

### ❌ Business Logic in RLS

RLS is for security, not business rules. Putting business logic in RLS is slow, inflexible, and hard to debug.

```sql
-- WRONG: Business logic in the security layer
USING (status = 'active' AND deal_value > 1000)

-- ✅ CORRECT: Security-focused RLS
USING (user_id = auth.uid() OR is_organization_member(auth.uid(), organization_id))
-- Filter in application: .eq('status', 'active').gte('deal_value', 1000)
```

### ❌ Complex Joins and Subqueries in RLS

Joins in RLS policies kill performance. Use `SECURITY DEFINER` functions to abstract away complexity and leverage indexes.

```sql
-- WRONG: Complex cross-table lookups
USING (EXISTS (
  SELECT 1 FROM user_roles ur
  JOIN organizations o ON ur.organization_id = o.id
  WHERE ur.user_id = auth.uid() AND o.status = 'active'
))

-- ✅ CORRECT: Use a simple function call
USING (public.is_active_organization_member(auth.uid(), organization_id))
```

### ❌ Recursive RLS Policies

Avoid policies that reference the same table they're protecting, as seen in the current user_roles migrations.

```sql
-- WRONG: Causes infinite recursion
CREATE POLICY "users_view_org_roles"
ON user_roles FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_roles ur2  -- Referencing same table!
    WHERE ur2.user_id = auth.uid() 
    AND ur2.organization_id = user_roles.organization_id
  )
);

-- ✅ CORRECT: Simple, direct access
CREATE POLICY "users_view_own_roles"
ON user_roles FOR SELECT
USING (auth.uid() = user_id);
```

## 🏗️ Schema Design for RLS

### Required Columns for Multi-Tenant CRM

Every table with restricted access should clearly define ownership and organization context.

```sql
-- For user-owned data within organizations:
user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
organization_id uuid REFERENCES organizations(id)

-- For organization-only data:
organization_id uuid NOT NULL REFERENCES organizations(id)
```

### Required Indexes for Performance

Your RLS policies are only as fast as your indexes. Index any columns used in your `USING` clauses.

```sql
-- Performance indexes for common RLS policies
CREATE INDEX CONCURRENTLY idx_[table_name]_user_id ON [table_name](user_id);
CREATE INDEX CONCURRENTLY idx_[table_name]_organization_id ON [table_name](organization_id);

-- Composite indexes for common query patterns
CREATE INDEX CONCURRENTLY idx_[table_name]_user_org ON [table_name](user_id, organization_id);

-- For role checks (critical for performance)
CREATE INDEX CONCURRENTLY idx_user_roles_user_org ON user_roles(user_id, organization_id);
CREATE INDEX CONCURRENTLY idx_user_roles_user_org_role ON user_roles(user_id, organization_id, role);
```

## 🔧 Helper Functions Standards

### Centralize RLS Logic in Functions

Abstract complex or repeated RLS logic into `SECURITY DEFINER` functions. This keeps policies simple, fast, and maintainable.

### Function Security Requirements

ALL RLS helper functions **MUST** follow these security practices.

```sql
CREATE OR REPLACE FUNCTION public.is_organization_owner(p_user_id uuid, p_organization_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER          -- Crucial for RLS
STABLE                    -- Performance optimization
SET search_path = ''      -- Security hardening to prevent hijacking
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = p_user_id 
    AND organization_id = p_organization_id
    AND role = 'owner'
  );
$$;
```

## 📊 SuperBro CRM-Specific Policy Recipes

### 1. Companies Table (`companies`)

**Access Pattern**: Personal + organizational data with role-based modification rights

```sql
-- Policy Recipe:
1. user_and_org_read_companies (FOR SELECT - view accessible companies)
2. user_create_own_companies (FOR INSERT - create with proper ownership)
3. members_update_companies (FOR UPDATE - members can edit organization companies)
4. admins_delete_companies (FOR DELETE - only admins can delete)
5. service_role_full_access_companies (FOR ALL - backend operations)
```

### 2. Contacts Table (`contacts`)

**Access Pattern**: Personal + organizational contacts with shared access

```sql
-- Policy Recipe:
1. user_and_org_read_contacts (FOR SELECT - view accessible contacts)
2. user_create_own_contacts (FOR INSERT - create with proper ownership)
3. members_update_contacts (FOR UPDATE - members can edit organization contacts)
4. owner_delete_contacts (FOR DELETE - owner/personal deletion rights)
5. service_role_full_access_contacts (FOR ALL - backend operations)
```

### 3. Deals Table (`deals`)

**Access Pattern**: Sales pipeline with team collaboration

```sql
-- Policy Recipe:
1. user_and_org_read_deals (FOR SELECT - view accessible deals)
2. user_create_own_deals (FOR INSERT - create with proper ownership)
3. members_update_deals (FOR UPDATE - team collaboration on deals)
4. admins_delete_deals (FOR DELETE - administrative control)
5. service_role_full_access_deals (FOR ALL - backend operations)
```

### 4. Tasks Table (`tasks`)

**Access Pattern**: Personal tasks + organization task sharing

```sql
-- Policy Recipe:
1. user_and_org_read_tasks (FOR SELECT - view accessible tasks)
2. user_create_own_tasks (FOR INSERT - create with proper ownership)
3. user_update_accessible_tasks (FOR UPDATE - update own + assigned tasks)
4. user_delete_accessible_tasks (FOR DELETE - delete own + admin rights)
5. service_role_full_access_tasks (FOR ALL - backend operations)
```

### 5. Lead Tables (`leads`, `lead_lists`, `lead_list_members`)

**Access Pattern**: Organization-wide lead management with user attribution

```sql
-- Policy Recipe for leads:
1. org_members_read_leads (FOR SELECT - organization lead access)
2. members_create_leads (FOR INSERT - members can add leads)
3. members_update_leads (FOR UPDATE - members can edit organization leads)
4. admins_delete_leads (FOR DELETE - administrative control)
5. service_role_full_access_leads (FOR ALL - backend operations)

-- Policy Recipe for lead_lists:
1. org_members_read_lead_lists (FOR SELECT - view organization lists)
2. members_manage_lead_lists (FOR ALL - members can manage lists)
3. service_role_full_access_lead_lists (FOR ALL - backend operations)
```

### 6. User Roles Table (`user_roles`)

**Access Pattern**: Critical security table requiring careful RLS

```sql
-- Policy Recipe:
1. users_view_own_roles (FOR SELECT - see own roles only)
2. admins_manage_org_roles (FOR INSERT/UPDATE/DELETE - role management)
3. service_role_full_access_user_roles (FOR ALL - backend operations)

-- CRITICAL: Avoid recursive policies that reference user_roles within user_roles RLS
```

### 7. Organizations Table (`organizations`)

**Access Pattern**: Organization information with hierarchical access

```sql
-- Policy Recipe:
1. members_view_own_org (FOR SELECT - see organizations you belong to)
2. admins_update_org (FOR UPDATE - admins can modify organization settings)
3. owners_delete_org (FOR DELETE - only owners can delete organizations)
4. service_role_full_access_organizations (FOR ALL - backend operations)
```

### 8. Task Automation Rules (`task_automation_rules`)

**Access Pattern**: Organization-wide automation with member management

```sql
-- Policy Recipe:
1. org_members_read_automation_rules (FOR SELECT - view organization rules)
2. members_manage_automation_rules (FOR ALL - members can create/manage rules)
3. service_role_full_access_automation_rules (FOR ALL - backend operations)
```

## 🚀 Performance Optimization

### Critical Performance Principles

#### 1. **Index Strategy - Essential for RLS Performance**

RLS policies can significantly impact query performance if not properly indexed.

```sql
-- ✅ REQUIRED: Index every column used in RLS USING clauses
CREATE INDEX CONCURRENTLY idx_companies_user_id ON companies(user_id);
CREATE INDEX CONCURRENTLY idx_companies_organization_id ON companies(organization_id);
CREATE INDEX CONCURRENTLY idx_deals_user_id ON deals(user_id);
CREATE INDEX CONCURRENTLY idx_deals_organization_id ON deals(organization_id);

-- ✅ CRITICAL: Composite indexes for common query patterns
CREATE INDEX CONCURRENTLY idx_user_roles_lookup 
ON user_roles(user_id, organization_id, role);

CREATE INDEX CONCURRENTLY idx_deals_org_status 
ON deals(organization_id, status, user_id);

-- ✅ SPECIALIZED: Partial indexes for active data
CREATE INDEX CONCURRENTLY idx_deals_active_pipeline
ON deals(organization_id, stage, user_id)
WHERE status IN ('Prospecting', 'Qualification', 'Proposal', 'Negotiation');
```

#### 2. **RLS Policy Performance Patterns**

```sql
-- ✅ FAST: Direct column equality (uses indexes efficiently)
USING (user_id = auth.uid())
USING (organization_id = get_user_organization(auth.uid()))

-- ⚠️ SLOWER: EXISTS with subqueries (still acceptable with proper indexes)
USING (EXISTS (
  SELECT 1 FROM user_roles 
  WHERE user_id = auth.uid() 
  AND organization_id = companies.organization_id
))

-- ❌ SLOW: Complex joins in RLS (avoid or wrap in functions)
USING (organization_id IN (
  SELECT o.id FROM organizations o
  JOIN user_roles ur ON o.id = ur.organization_id
  WHERE ur.user_id = auth.uid()
))
```

#### 3. **Query Pattern Guidelines**

```sql
-- ✅ OPTIMAL: Filter on RLS-indexed columns in application queries
SELECT * FROM companies 
WHERE organization_id = $1  -- RLS-friendly organization filter
AND industry = 'Technology'  -- Additional business filter
ORDER BY created_at DESC;

-- ✅ GOOD: Use user context efficiently  
SELECT * FROM deals d
WHERE d.user_id = auth.uid()  -- RLS-friendly user filter
AND d.status = 'open'
ORDER BY d.expected_close_date ASC;

-- ❌ AVOID: Queries that don't leverage RLS indexes
SELECT * FROM companies 
WHERE name ILIKE '%company%'  -- No RLS column filter
ORDER BY created_at DESC;     -- RLS will scan all accessible rows
```

## 🔒 SuperBro CRM Security Validation Checklist

### Core Security Tests
- [ ] **User Isolation**: Can User A access User B's personal data (contacts, companies, deals)?
- [ ] **Organization Isolation**: Can User A access Organization B's data when they don't belong to it?
- [ ] **Role Boundaries**: Can a `viewer` perform `member`, `admin`, or `owner` actions?
- [ ] **Ownership Enforcement**: Can User A modify/delete User B's personal records?
- [ ] **Cross-Organization Access**: Can members of Org A access any data from Org B?
- [ ] **Service Role**: Verify service role has appropriate access and is used correctly.
- [ ] **Function Security**: Are all helper functions `SECURITY DEFINER` with `search_path = ''`?

### RLS Policy Audit Checklist

**Security Verification:**
- [ ] Does this policy use indexed columns in the `USING` clause?
- [ ] Is the policy as restrictive as possible while meeting requirements?
- [ ] Are we avoiding business logic in security policies?
- [ ] Does the policy name clearly describe what it allows?
- [ ] Are we using helper functions for complex role checks?
- [ ] Is `search_path = ''` set on all `SECURITY DEFINER` functions?
- [ ] Are we avoiding recursive references (especially in user_roles table)?

**Performance Verification:**
- [ ] Are all columns used in RLS policies properly indexed?
- [ ] Are we avoiding complex JOINs directly in policies?
- [ ] Are helper functions marked as `STABLE` for caching?
- [ ] Do application queries filter on RLS-protected columns first?

**Completeness Verification:**
- [ ] Are all CRUD operations (SELECT, INSERT, UPDATE, DELETE) covered?
- [ ] Is there a service role policy for backend operations?
- [ ] Are edge cases (users without organizations, pending invites) handled?

### CRM-Specific Tests

#### Multi-Tenant Isolation Tests
- [ ] **Organization Boundaries**: Can users access data from organizations they don't belong to?
- [ ] **Personal vs Shared Data**: Can organization members access each other's personal data appropriately?
- [ ] **Role Escalation**: Can users gain higher privileges than assigned?
- [ ] **Data Leakage**: Can queries reveal information about other organizations' data structure/existence?

#### Role Hierarchy Tests
- [ ] **Viewer Rights**: Can viewers only read data without modification rights?
- [ ] **Member Rights**: Can members create/edit but not delete critical data?
- [ ] **Admin Rights**: Can admins manage users and organization settings?
- [ ] **Owner Rights**: Can owners perform all operations including organization deletion?

### Test Scenarios by Role

#### Viewer Tests
```sql
-- Test as viewer
SET request.jwt.claims TO '{"sub": "viewer-user-id", "role": "authenticated"}';

-- ✅ Should work: View organization companies
SELECT * FROM companies WHERE organization_id = 'my-org-id';

-- ❌ Should fail: Create new companies
INSERT INTO companies (name, organization_id) VALUES ('Test', 'my-org-id');

-- ❌ Should fail: Update existing companies
UPDATE companies SET name = 'Updated' WHERE organization_id = 'my-org-id';
```

#### Member Tests
```sql
-- Test as member
SET request.jwt.claims TO '{"sub": "member-user-id", "role": "authenticated"}';

-- ✅ Should work: Create and update companies
INSERT INTO companies (name, organization_id) VALUES ('New Company', 'my-org-id');
UPDATE companies SET industry = 'Tech' WHERE organization_id = 'my-org-id';

-- ❌ Should fail: Access other organizations' data
SELECT * FROM companies WHERE organization_id = 'other-org-id';
```

#### Admin Tests
```sql
-- Test as admin
SET request.jwt.claims TO '{"sub": "admin-user-id", "role": "authenticated"}';

-- ✅ Should work: Manage user roles
INSERT INTO user_roles (user_id, organization_id, role) 
VALUES ('new-user-id', 'my-org-id', 'member');

-- ✅ Should work: Delete organization data
DELETE FROM companies WHERE organization_id = 'my-org-id';

-- ❌ Should fail: Access other organizations' user roles
SELECT * FROM user_roles WHERE organization_id = 'other-org-id';
```

---

## 🔄 Migration Strategy for Existing Policies

Based on the current migration files, here's a recommended approach to align with these best practices:

### Current Issues to Address:
1. **Recursive RLS in user_roles**: The current policies reference user_roles within user_roles policies
2. **Missing organization context**: Some policies don't account for organization membership
3. **Inconsistent helper function usage**: Some policies use direct queries instead of helper functions
4. **Performance concerns**: Missing critical indexes for RLS performance

### Recommended Migration Steps:
1. Create optimized helper functions following security standards
2. Update existing policies to use helper functions and proper organization context
3. Add missing performance indexes
4. Test all policies thoroughly with the provided test scenarios

**Document Version**: 1.0 - SuperBro CRM Implementation  
**Updated**: 2025-09-26  
**Author**: SuperBro CRM Development Team  
**Status**: ACTIVE - SuperBro CRM RLS Standards  
**Based On**: Current project analysis + Supabase best practices
