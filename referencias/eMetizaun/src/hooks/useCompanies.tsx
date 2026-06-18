import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { useOrganizationContext } from "./useOrganizationContext";

export interface Company {
  id: string;
  user_id: string;
  organization_id: string;
  name: string;
  industry?: string;
  website?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postal_code?: string;
  employee_count?: number;
  annual_revenue?: number;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export type CompanyInsert = Omit<Company, 'id' | 'user_id' | 'organization_id' | 'created_at' | 'updated_at'>;
export type CompanyUpdate = Partial<CompanyInsert>;

export const useCompanies = () => {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const { currentOrganization } = useOrganizationContext();

  const fetchCompanies = useCallback(async (): Promise<Company[]> => {
    // ✅ FIX 1: Validação completa com loading state
    if (!user?.id || !currentOrganization?.id) {
      console.log('fetchCompanies: Aguardando autenticação completa', { 
        userId: user?.id, 
        organizationId: currentOrganization?.id 
      });
      setLoading(false); // ✅ Importante: atualiza loading mesmo quando não há dados
      setCompanies([]); // ✅ Limpa empresas se não há organização
      return [];
    }

    try {
      setLoading(true);
      console.log('fetchCompanies: Fetching for organization:', currentOrganization.id);
      
      const { data, error } = await supabase
        .from('companies')
        .select('*')
        .eq('organization_id', currentOrganization.id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('fetchCompanies: Supabase error:', error);
        throw error;
      }

      const companiesData = data || [];
      console.log('fetchCompanies: Retrieved companies:', companiesData.length, 'companies');
      
      setCompanies(companiesData);
      return companiesData;
    } catch (error) {
      console.error('Error fetching companies:', error);
      setCompanies([]); // ✅ Limpa empresas em caso de erro
      return [];
    } finally {
      setLoading(false);
    }
  }, [user?.id, currentOrganization?.id]);

  // ✅ FIX 2: useEffect otimizado - só executa quando ambos estão disponíveis
  useEffect(() => {
    if (user?.id && currentOrganization?.id) {
      console.log('useCompanies: Iniciando fetch com organização:', currentOrganization.id);
      fetchCompanies();
    } else {
      console.log('useCompanies: Aguardando user e organization');
      setLoading(false);
      setCompanies([]);
    }
  }, [user?.id, currentOrganization?.id, fetchCompanies]);

  const createCompany = async (company: CompanyInsert): Promise<Company> => {
    if (!user) {
      console.error('createCompany: No user authenticated');
      throw new Error('User not authenticated');
    }
    
    if (!currentOrganization) {
      console.error('createCompany: No organization selected', { user: user.email, userId: user.id });
      throw new Error('No organization selected');
    }

    console.log('createCompany: Creating company with data:', {
      ...company,
      user_id: user.id,
      organization_id: currentOrganization.id,
    });

    const { data, error } = await supabase
      .from('companies')
      .insert({
        ...company,
        user_id: user.id,
        organization_id: currentOrganization.id,
      })
      .select()
      .single();

    if (error) {
      const message = typeof error.message === 'string' ? error.message : JSON.stringify(error);
      console.error('createCompany: Supabase error:', message);
      throw new Error(message);
    }

    console.log('createCompany: Successfully created company:', data);
    setCompanies(prev => [data, ...prev]);
    return data;
  };

  const updateCompany = async (id: string, updates: CompanyUpdate): Promise<Company> => {
    if (!user || !currentOrganization) throw new Error('User not authenticated or no organization selected');

    const { data, error } = await supabase
      .from('companies')
      .update(updates)
      .eq('id', id)
      .eq('organization_id', currentOrganization.id)
      .select()
      .single();

    if (error) throw error;

    setCompanies(prev => prev.map(company => company.id === data.id ? data : company));
    return data;
  };

  const deleteCompany = async (id: string): Promise<void> => {
    if (!user || !currentOrganization) throw new Error('User not authenticated or no organization selected');

    const { error } = await supabase
      .from('companies')
      .delete()
      .eq('id', id)
      .eq('organization_id', currentOrganization.id);

    if (error) throw error;

    setCompanies(prev => prev.filter(company => company.id !== id));
  };

  const getCompanyById = async (id: string): Promise<Company | null> => {
    if (!user || !currentOrganization) throw new Error('User not authenticated or no organization selected');

    const { data, error } = await supabase
      .from('companies')
      .select('*')
      .eq('id', id)
      .eq('organization_id', currentOrganization.id)
      .maybeSingle();

    if (error) throw error;
    return data;
  };

  return {
    companies,
    loading,
    fetchCompanies,
    createCompany,
    updateCompany,
    deleteCompany,
    getCompanyById,
  };
};