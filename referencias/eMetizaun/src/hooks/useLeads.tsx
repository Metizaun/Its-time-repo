import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationContext } from './useOrganizationContext';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from './useAuth';

export interface Lead {
  id: string;
  user_id: string;
  organization_id: string;
  email: string;
  first_name: string;
  last_name: string;
  company?: string;
  phone?: string;
  website?: string;
  title?: string;
  industry?: string;
  location?: string;
  source?: string;
  status: string;
  score: number;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export function useLeads() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const { currentOrganization } = useOrganizationContext();
  const { user } = useAuth();
  const { toast } = useToast();

  const fetchLeads = useCallback(async () => {
    if (!currentOrganization) return;

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .eq('organization_id', currentOrganization.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setLeads(data || []);
    } catch (error) {
      console.error('Error fetching leads:', error);
      toast({
        title: "Error",
        description: "Failed to fetch leads",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [currentOrganization, toast]);

  const createLead = async (leadData: Omit<Lead, 'id' | 'created_at' | 'updated_at'>) => {
    try {
      if (!currentOrganization || !user) {
        throw new Error('No organization or user context');
      }

      const payload = {
        ...leadData,
        organization_id: currentOrganization.id,
        user_id: user.id,
      };

      const { data, error } = await supabase
        .from('leads')
        .insert([payload])
        .select()
        .single();

      if (error) throw error;

      // Optimistically update the state immediately
      setLeads(prev => [data, ...prev]);
      
      toast({
        title: "Success",
        description: "Lead created successfully",
      });
      return data;
    } catch (error) {
      console.error('Error creating lead:', error);
      toast({
        title: "Error",
        description: "Failed to create lead",
        variant: "destructive",
      });
      throw error;
    }
  };

  const updateLead = async (id: string, updates: Partial<Lead>) => {
    // Find the current lead for optimistic update and potential rollback
    const currentLead = leads.find(lead => lead.id === id);
    if (!currentLead) return;

    // Optimistically update the local state
    const updatedLead = { ...currentLead, ...updates };
    setLeads(prevLeads => 
      prevLeads.map(lead => lead.id === id ? updatedLead : lead)
    );

    try {
      const { data, error } = await supabase
        .from('leads')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      // Replace with server data on success
      if (data) {
        setLeads(prevLeads => 
          prevLeads.map(lead => lead.id === id ? data : lead)
        );
      }

      return data;
    } catch (error) {
      console.error('Error updating lead:', error);
      // Revert optimistic update on error
      setLeads(prevLeads => 
        prevLeads.map(lead => lead.id === id ? currentLead : lead)
      );
      toast({
        title: "Error",
        description: "Failed to update lead",
        variant: "destructive",
      });
      throw error;
    }
  };

  const deleteLead = async (id: string) => {
    try {
      if (!currentOrganization) {
        throw new Error('No organization selected');
      }

      // Perform delete on server
      const { error } = await supabase
        .from('leads')
        .delete()
        .eq('id', id)
        .eq('organization_id', currentOrganization.id);

      if (error) throw error;

      // Update local state immediately so the UI reflects the deletion without refresh
      setLeads(prev => prev.filter(lead => lead.id !== id));

      toast({
        title: "Success",
        description: "Lead deleted successfully",
      });
    } catch (error) {
      console.error('Error deleting lead:', error);
      toast({
        title: "Error",
        description: "Failed to delete lead",
        variant: "destructive",
      });
      throw error;
    }
  };

  useEffect(() => {
    fetchLeads();

    // Set up real-time subscription for leads
    if (!currentOrganization) return;

    const channel = supabase
      .channel('leads-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'leads',
          filter: `organization_id=eq.${currentOrganization.id}`,
        },
        (payload) => {
          console.log('Real-time lead change:', payload);
          
          if (payload.eventType === 'INSERT' && payload.new) {
            setLeads(prev => [payload.new as Lead, ...prev]);
          } else if (payload.eventType === 'UPDATE' && payload.new) {
            setLeads(prev => prev.map(lead => 
              lead.id === (payload.new as Lead).id ? payload.new as Lead : lead
            ));
          } else if (payload.eventType === 'DELETE' && payload.old) {
            setLeads(prev => prev.filter(lead => lead.id !== (payload.old as Lead).id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchLeads, currentOrganization]);

  return {
    leads,
    loading,
    fetchLeads,
    createLead,
    updateLead,
    deleteLead,
  };
}