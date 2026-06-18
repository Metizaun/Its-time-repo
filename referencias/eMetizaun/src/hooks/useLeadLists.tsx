import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationContext } from './useOrganizationContext';
import { useAuth } from './useAuth';
import { useToast } from '@/hooks/use-toast';
import { CriteriaRule } from '@/components/SmartListCriteriaBuilder';

export interface LeadList {
  id: string;
  user_id: string;
  organization_id: string;
  name: string;
  description?: string;
  type: 'static' | 'smart';
  criteria?: any;
  created_at: string;
  updated_at: string;
}

export interface LeadListMember {
  id: string;
  lead_id: string;
  list_id: string;
  added_by: string;
  added_at: string;
}

export function useLeadLists() {
  const [leadLists, setLeadLists] = useState<LeadList[]>([]);
  const [loading, setLoading] = useState(true);
  const { currentOrganization } = useOrganizationContext();
  const { user } = useAuth();
  const { toast } = useToast();

  const fetchLeadLists = async () => {
    if (!currentOrganization) return;

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('lead_lists')
        .select('*')
        .eq('organization_id', currentOrganization.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setLeadLists((data || []) as LeadList[]);
    } catch (error) {
      console.error('Error fetching lead lists:', error);
      toast({
        title: "Error",
        description: "Failed to fetch lead lists",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const createLeadList = async (listData: Omit<LeadList, 'id' | 'created_at' | 'updated_at'>) => {
    try {
      const { data, error } = await supabase
        .from('lead_lists')
        .insert([listData])
        .select()
        .single();

      if (error) throw error;

      setLeadLists(prev => [data as LeadList, ...prev]);
      toast({
        title: "Success",
        description: "Lead list created successfully",
      });
      return data;
    } catch (error) {
      console.error('Error creating lead list:', error);
      toast({
        title: "Error",
        description: "Failed to create lead list",
        variant: "destructive",
      });
      throw error;
    }
  };

  const updateLeadList = async (id: string, updates: Partial<LeadList>) => {
    try {
      const { data, error } = await supabase
        .from('lead_lists')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      setLeadLists(prev => prev.map(list => list.id === id ? data as LeadList : list));
      toast({
        title: "Success",
        description: "Lead list updated successfully",
      });
      return data;
    } catch (error) {
      console.error('Error updating lead list:', error);
      toast({
        title: "Error",
        description: "Failed to update lead list",
        variant: "destructive",
      });
      throw error;
    }
  };

  const deleteLeadList = async (id: string) => {
    try {
      const { error } = await supabase
        .from('lead_lists')
        .delete()
        .eq('id', id);

      if (error) throw error;

      setLeadLists(prev => prev.filter(list => list.id !== id));
      toast({
        title: "Success",
        description: "Lead list deleted successfully",
      });
    } catch (error) {
      console.error('Error deleting lead list:', error);
      toast({
        title: "Error",
        description: "Failed to delete lead list",
        variant: "destructive",
      });
      throw error;
    }
  };

  const addLeadToList = async (leadId: string, listId: string) => {
    if (!user) return;

    try {
      const { error } = await supabase
        .from('lead_list_members')
        .insert([{
          lead_id: leadId,
          list_id: listId,
          added_by: user.id,
        }]);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Lead added to list successfully",
      });
    } catch (error) {
      console.error('Error adding lead to list:', error);
      toast({
        title: "Error",
        description: "Failed to add lead to list",
        variant: "destructive",
      });
      throw error;
    }
  };

  const removeLeadFromList = async (leadId: string, listId: string) => {
    try {
      const { error } = await supabase
        .from('lead_list_members')
        .delete()
        .eq('lead_id', leadId)
        .eq('list_id', listId);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Lead removed from list successfully",
      });
    } catch (error) {
      console.error('Error removing lead from list:', error);
      toast({
        title: "Error",
        description: "Failed to remove lead from list",
        variant: "destructive",
      });
      throw error;
    }
  };

  const getListMembers = async (listId: string) => {
    try {
      // First get the list to check if it's smart or static
      const { data: list, error: listError } = await supabase
        .from('lead_lists')
        .select('*')
        .eq('id', listId)
        .single();

      if (listError) throw listError;

      if (list.type === 'smart') {
        // For smart lists, calculate members based on criteria
        return await getSmartListMembers(list as LeadList);
      } else {
        // For static lists, get members from lead_list_members table
        const { data, error } = await supabase
          .from('lead_list_members')
          .select(`
            *,
            leads (*)
          `)
          .eq('list_id', listId);

        if (error) throw error;
        return data || [];
      }
    } catch (error) {
      console.error('Error fetching list members:', error);
      toast({
        title: "Error",
        description: "Failed to fetch list members",
        variant: "destructive",
      });
      return [];
    }
  };

  const getListsForLead = async (leadId: string) => {
    try {
      const { data, error } = await supabase
        .from('lead_list_members')
        .select(`
          *,
          lead_lists (*)
        `)
        .eq('lead_id', leadId);

      if (error) throw error;
      return (data || []).map(item => item.lead_lists) as LeadList[];
    } catch (error) {
      console.error('Error fetching lists for lead:', error);
      toast({
        title: "Error",
        description: "Failed to fetch lists for lead",
        variant: "destructive",
      });
      return [];
    }
  };

  const getSmartListMembers = async (list: LeadList) => {
    if (!list.criteria || !Array.isArray(list.criteria)) {
      return [];
    }

    try {
      let query = supabase
        .from('leads')
        .select('*')
        .eq('organization_id', list.organization_id);

      // Apply each criteria rule
      for (const rule of list.criteria as CriteriaRule[]) {
        query = applyRuleToQuery(query, rule);
      }

      const { data: leads, error } = await query;
      
      if (error) throw error;

      // Transform to match the expected format
      return (leads || []).map(lead => ({
        id: `smart-${lead.id}`,
        lead_id: lead.id,
        list_id: list.id,
        added_by: 'system',
        added_at: lead.created_at,
        leads: lead,
      }));
    } catch (error) {
      console.error('Error fetching smart list members:', error);
      return [];
    }
  };

  const applyRuleToQuery = (query: any, rule: CriteriaRule) => {
    const { field, operator, value } = rule;

    switch (operator) {
      case 'equals':
        return query.eq(field, value);
      case 'not_equals':
        return query.neq(field, value);
      case 'contains':
        return query.ilike(field, `%${value}%`);
      case 'starts_with':
        return query.ilike(field, `${value}%`);
      case 'ends_with':
        return query.ilike(field, `%${value}`);
      case 'greater_than':
        return query.gt(field, parseFloat(value));
      case 'less_than':
        return query.lt(field, parseFloat(value));
      case 'greater_equal':
        return query.gte(field, parseFloat(value));
      case 'less_equal':
        return query.lte(field, parseFloat(value));
      case 'after':
        return query.gt(field, value);
      case 'before':
        return query.lt(field, value);
      case 'in_last_days':
        const daysAgo = new Date();
        daysAgo.setDate(daysAgo.getDate() - parseInt(value));
        return query.gte(field, daysAgo.toISOString());
      default:
        return query;
    }
  };

  useEffect(() => {
    fetchLeadLists();
  }, [currentOrganization]);

  return {
    leadLists,
    loading,
    fetchLeadLists,
    createLeadList,
    updateLeadList,
    deleteLeadList,
    addLeadToList,
    removeLeadFromList,
    getListMembers,
    getListsForLead,
  };
}