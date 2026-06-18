import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';

export interface Organization {
  id: string;
  name: string;
  timezone: string;
  created_at: string;
  updated_at: string;
}

export interface UserRole {
  id: string;
  user_id: string;
  organization_id: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  created_at: string;
  updated_at: string;
  profiles?: {
    display_name: string | null;
  };
}

export interface OrganizationMember {
  id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  profiles: {
    display_name: string | null;
  };
}

export type OrganizationInsert = {
  name: string;
  timezone?: string;
};
export type UserRoleInsert = Omit<UserRole, 'id' | 'created_at' | 'updated_at'>;

export function useOrganizations() {
  const { user } = useAuth();

  const getFunctionAuthHeaders = async (): Promise<Record<string, string>> => {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      throw new Error('Failed to get session');
    }

    let accessToken = sessionData.session?.access_token;
    if (!accessToken) {
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) {
        throw new Error('Missing authorization header');
      }
      accessToken = refreshData.session?.access_token;
    }

    if (!accessToken) {
      throw new Error('Missing authorization header');
    }

    return {
      Authorization: `Bearer ${accessToken}`
    };
  };

  const fetchUserOrganizations = async (): Promise<Organization[]> => {
    if (!user) throw new Error('User not authenticated');

    // Diagnostic logs
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const expectedUrl = 'https://hkqrgomafbohittsdnea.supabase.co';
    const maskedUrl = supabaseUrl ? `${supabaseUrl.substring(0, 20)}...` : 'NOT SET';
    const isCorrectProject = supabaseUrl === expectedUrl;
    
    console.log('useOrganizations: [DIAGNOSTIC] Supabase URL:', maskedUrl);
    console.log('useOrganizations: [DIAGNOSTIC] Expected URL: https://hkqrgomafbohittsdnea.supabase.co');
    console.log('useOrganizations: [DIAGNOSTIC] Connected to correct project:', isCorrectProject);
    
    if (!isCorrectProject) {
      console.error('useOrganizations: [ERROR] ⚠️ VOCÊ ESTÁ CONECTADO AO PROJETO SUPABASE ERRADO!');
      console.error('useOrganizations: [ERROR] Por favor, siga estes passos:');
      console.error('useOrganizations: [ERROR] 1. Crie o arquivo .env.local na raiz do projeto com:');
      console.error('useOrganizations: [ERROR]    VITE_SUPABASE_URL=https://hkqrgomafbohittsdnea.supabase.co');
      console.error('useOrganizations: [ERROR]    VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_Q7QBDFMNFtzZw9b3xfZJJQ_7SeUE7-q');
      console.error('useOrganizations: [ERROR] 2. Reinicie o servidor de desenvolvimento');
      console.error('useOrganizations: [ERROR] 3. Faça logout e login novamente');
      console.error('useOrganizations: [ERROR] Veja CONFIGURACAO_SUPABASE.md para mais detalhes');
    }
    
    console.log('useOrganizations: [DIAGNOSTIC] User authenticated - Email:', user.email, 'ID:', user.id);
    console.log('useOrganizations: [DIAGNOSTIC] Expected user ID in database: 3ff5eb29-e23e-45ac-96e6-5f7f3f0fda18');
    console.log('useOrganizations: [DIAGNOSTIC] Current user ID matches expected:', user.id === '3ff5eb29-e23e-45ac-96e6-5f7f3f0fda18');
    
    if (user.id !== '3ff5eb29-e23e-45ac-96e6-5f7f3f0fda18' && isCorrectProject) {
      console.warn('useOrganizations: [WARNING] Usuário autenticado não corresponde ao usuário no banco de dados');
      console.warn('useOrganizations: [WARNING] Isso é normal se você acabou de configurar o .env.local');
      console.warn('useOrganizations: [WARNING] Faça logout e login novamente para autenticar no projeto correto');
    }

    console.log('useOrganizations: Fetching organizations for user:', user.email, 'ID:', user.id);

    // Step 1: Get user_roles for this user
    const { data: userRoles, error: rolesError } = await supabase
      .from('user_roles')
      .select('organization_id')
      .eq('user_id', user.id);

    if (rolesError) {
      console.error('useOrganizations: [ERROR] Error fetching user roles:', rolesError);
      console.error('useOrganizations: [ERROR] Error details:', {
        message: rolesError.message,
        details: rolesError.details,
        hint: rolesError.hint,
        code: rolesError.code
      });
      throw rolesError;
    }

    console.log('useOrganizations: User roles data:', userRoles);
    console.log('useOrganizations: [DIAGNOSTIC] Query returned', userRoles?.length || 0, 'user roles');

    if (!userRoles || userRoles.length === 0) {
      console.warn('useOrganizations: [WARNING] No user roles found for user');
      console.warn('useOrganizations: [WARNING] This may indicate:');
      console.warn('useOrganizations: [WARNING] 1. User is not connected to the correct Supabase project');
      console.warn('useOrganizations: [WARNING] 2. User does not have any organization assignments');
      console.warn('useOrganizations: [WARNING] 3. RLS policies may be blocking the query');
      return [];
    }

    // Step 2: Get organizations using the organization_ids
    const organizationIds = userRoles.map(ur => ur.organization_id);
    console.log('useOrganizations: Fetching organizations with IDs:', organizationIds);

    const { data: organizationsWithTimezone, error: orgsError } = await supabase
      .from('organizations')
      .select('id, name, timezone, created_at, updated_at')
      .in('id', organizationIds);

    if (!orgsError) {
      console.log('useOrganizations: Organizations found:', organizationsWithTimezone);
      return organizationsWithTimezone || [];
    }

    // Backward-compatible fallback when the timezone migration is not applied yet.
    if (orgsError.code === '42703') {
      console.warn('useOrganizations: organizations.timezone column not found, using fallback query.');

      const { data: organizationsLegacy, error: legacyError } = await supabase
        .from('organizations')
        .select('id, name, created_at, updated_at')
        .in('id', organizationIds);

      if (legacyError) {
        console.error('useOrganizations: Fallback organizations query failed:', legacyError);
        throw legacyError;
      }

      const normalizedOrganizations: Organization[] = (organizationsLegacy || []).map((organization) => ({
        ...organization,
        timezone: 'America/Sao_Paulo',
      }));

      console.log('useOrganizations: Organizations found with fallback:', normalizedOrganizations);
      return normalizedOrganizations;
    }

    console.error('useOrganizations: Error fetching organizations:', orgsError);
    throw orgsError;
  };

  const fetchOrganizationMembers = async (organizationId: string): Promise<OrganizationMember[]> => {
    if (!user) throw new Error('User not authenticated');

    // First get user roles, then fetch profiles separately to avoid relation issues
    const { data: userRoles, error: rolesError } = await supabase
      .from('user_roles')
      .select('id, user_id, role')
      .eq('organization_id', organizationId);

    if (rolesError) throw rolesError;

    if (!userRoles || userRoles.length === 0) return [];

    // Fetch profiles for all user_ids
    const userIds = userRoles.map(ur => ur.user_id);
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('user_id, display_name')
      .in('user_id', userIds);

    if (profilesError) throw profilesError;

    // Combine the data
    return userRoles.map(userRole => ({
      id: userRole.id,
      user_id: userRole.user_id,
      role: userRole.role,
      profiles: {
        display_name: profiles?.find(p => p.user_id === userRole.user_id)?.display_name || null
      }
    }));
  };

  const getUserRole = async (organizationId: string): Promise<UserRole['role'] | null> => {
    if (!user) return null;

    const { data, error } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('organization_id', organizationId)
      .single();

    if (error) return null;
    return data?.role || null;
  };

  const createOrganization = async (organization: OrganizationInsert): Promise<Organization> => {
    if (!user) throw new Error('User not authenticated');

    const { data: orgData, error: orgError } = await supabase
      .from('organizations')
      .insert(organization)
      .select()
      .single();

    if (orgError) throw orgError;

    // Make the user the owner of the new organization
    const { error: roleError } = await supabase
      .from('user_roles')
      .insert({
        user_id: user.id,
        organization_id: orgData.id,
        role: 'owner'
      });

    if (roleError) throw roleError;

    return orgData;
  };

  const updateOrganization = async (id: string, updates: Partial<OrganizationInsert>): Promise<Organization> => {
    const { data, error } = await supabase
      .from('organizations')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  };

  const createUser = async (organizationId: string, email: string, password: string, displayName: string, role: UserRole['role']): Promise<void> => {
    const headers = await getFunctionAuthHeaders();
    const { data, error } = await supabase.functions.invoke('create-user', {
      headers,
      body: {
        email,
        password,
        displayName,
        role,
        organizationId
      }
    });

    if (error) throw new Error(`Failed to create user: ${error.message}`);
    if (data.error) throw new Error(`Failed to create user: ${data.error}`);
  };

  const updateUserRole = async (userRoleId: string, role: UserRole['role']): Promise<void> => {
    const { error } = await supabase
      .from('user_roles')
      .update({ role })
      .eq('id', userRoleId);

    if (error) throw error;
  };

  const removeUser = async (userRoleId: string): Promise<void> => {
    const headers = await getFunctionAuthHeaders();
    const { data, error } = await supabase.functions.invoke('delete-user', {
      headers,
      body: {
        userRoleId
      }
    });

    if (error) throw new Error(`Failed to remove user: ${error.message}`);
    if (data.error) throw new Error(`Failed to remove user: ${data.error}`);
  };

  return {
    fetchUserOrganizations,
    fetchOrganizationMembers,
    getUserRole,
    createOrganization,
    updateOrganization,
    createUser,
    updateUserRole,
    removeUser
  };
}
