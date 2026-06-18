import { useAuth } from '@/hooks/useAuth';
import { useOrganizationContext } from '@/hooks/useOrganizationContext';
import { supabase } from '@/integrations/supabase/client';

export interface Deal {
  id: string;
  user_id: string;
  organization_id: string;
  title: string;
  description?: string;
  value?: number;
  status: string;
  stage: string;
  probability?: number;
  contact_id?: string;
  company_id?: string;
  expected_close_date?: string;
  actual_close_date?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export type DealInsert = Omit<Deal, 'id' | 'user_id' | 'organization_id' | 'created_at' | 'updated_at'>;
export type DealUpdate = Partial<DealInsert>;

// Deal stages and statuses
export const DEAL_STAGES = [
  'New',
  'Contacted',
  'Qualified',
  'Proposal',
  'Negotiation',
  'Closed Won',
  'Closed Lost'
] as const;

export const DEAL_STATUSES = [
  'Active',
  'Won',
  'Lost',
  'On Hold'
] as const;

export const useDeals = () => {
  const { user } = useAuth();
  const { currentOrganization } = useOrganizationContext();

  const fetchDeals = async (): Promise<Deal[]> => {
    if (!user || !currentOrganization) {
      console.error('Deals fetch failed: User not authenticated or no organization selected');
      throw new Error('User not authenticated or no organization selected');
    }

    const { data, error } = await supabase
      .from('deals')
      .select('*')
      .eq('organization_id', currentOrganization.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Supabase error fetching deals:', error);
      throw error;
    }

    return data || [];
  };

  const createDeal = async (deal: DealInsert): Promise<Deal> => {
    if (!user || !currentOrganization) throw new Error('User not authenticated or no organization selected');

    const { data, error } = await supabase
      .from('deals')
      .insert({
        ...deal,
        user_id: user.id,
        organization_id: currentOrganization.id,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  };

  const updateDeal = async (id: string, updates: DealUpdate): Promise<Deal> => {
    if (!user || !currentOrganization) throw new Error('User not authenticated or no organization selected');

    const { data, error } = await supabase
      .from('deals')
      .update(updates)
      .eq('id', id)
      .eq('organization_id', currentOrganization.id)
      .select()
      .single();

    if (error) throw error;
    return data;
  };

  const deleteDeal = async (id: string): Promise<void> => {
    if (!user || !currentOrganization) throw new Error('User not authenticated or no organization selected');

    const { error } = await supabase
      .from('deals')
      .delete()
      .eq('id', id)
      .eq('organization_id', currentOrganization.id);

    if (error) throw error;
  };

  const getDealById = async (id: string): Promise<Deal | null> => {
    if (!user || !currentOrganization) throw new Error('User not authenticated or no organization selected');

    const { data, error } = await supabase
      .from('deals')
      .select('*')
      .eq('id', id)
      .eq('organization_id', currentOrganization.id)
      .maybeSingle();

    if (error) throw error;
    return data;
  };

  return {
    fetchDeals,
    createDeal,
    updateDeal,
    deleteDeal,
    getDealById,
  };
};