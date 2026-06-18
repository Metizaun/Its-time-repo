import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useOrganizationContext } from '@/hooks/useOrganizationContext';
import { supabase } from '@/integrations/supabase/client';

export interface TaskAutomationRule {
  id: string;
  user_id: string;
  organization_id: string;
  name: string;
  description?: string;
  enabled: boolean;
  trigger_type: 'deal_created' | 'deal_stage_changed' | 'contact_created' | 'company_created' | 'lead_converted' | 'date_based' | 'manual' | 'birthday_approaching' | 'anniversary_approaching' | 'important_date_approaching';
  trigger_conditions?: any;
  task_template: {
    title: string;
    description?: string;
    status: string;
    priority: string;
    due_date_offset?: number; // days from trigger
    assign_to?: 'creator' | 'specific_user';
    assigned_user_id?: string;
  };
  created_at: string;
  updated_at: string;
}

export type TaskAutomationRuleInsert = Omit<TaskAutomationRule, 'id' | 'user_id' | 'organization_id' | 'created_at' | 'updated_at'>;
export type TaskAutomationRuleUpdate = Partial<TaskAutomationRuleInsert>;

export const TRIGGER_TYPES = [
  { value: 'deal_created', label: 'Deal Created' },
  { value: 'deal_stage_changed', label: 'Deal Stage Changed' },
  { value: 'contact_created', label: 'Contact Created' },
  { value: 'company_created', label: 'Company Created' },
  { value: 'lead_converted', label: 'Lead Converted' },
  { value: 'birthday_approaching', label: 'Birthday Approaching' },
  { value: 'anniversary_approaching', label: 'Anniversary Approaching' },
  { value: 'important_date_approaching', label: 'Important Date Approaching' },
  { value: 'date_based', label: 'Date Based' },
  { value: 'manual', label: 'Manual Trigger' },
];

export function useTaskAutomation() {
  const [rules, setRules] = useState<TaskAutomationRule[]>([]);
  const [loading, setLoading] = useState(false);
  const { user } = useAuth();
  const { currentOrganization } = useOrganizationContext();

  const fetchRules = async () => {
    if (!user || !currentOrganization) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('task_automation_rules')
        .select('*')
        .eq('organization_id', currentOrganization.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setRules((data || []) as TaskAutomationRule[]);
    } catch (error) {
      console.error('Error fetching automation rules:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRules();
  }, [user, currentOrganization]);

  const createRule = async (ruleData: TaskAutomationRuleInsert) => {
    if (!user || !currentOrganization) throw new Error('User not authenticated or no organization selected');

    const { data, error } = await supabase
      .from('task_automation_rules')
      .insert({
        ...ruleData,
        user_id: user.id,
        organization_id: currentOrganization.id,
      })
      .select()
      .single();

    if (error) throw error;
    
    fetchRules();
    return data;
  };

  const updateRule = async (id: string, updates: TaskAutomationRuleUpdate): Promise<TaskAutomationRule> => {
    if (!user || !currentOrganization) throw new Error('User not authenticated or no organization selected');

    const { data, error } = await supabase
      .from('task_automation_rules')
      .update(updates)
      .eq('id', id)
      .eq('organization_id', currentOrganization.id)
      .select()
      .single();

    if (error) throw error;
    
    fetchRules();
    return data as TaskAutomationRule;
  };

  const deleteRule = async (id: string): Promise<void> => {
    if (!user || !currentOrganization) throw new Error('User not authenticated or no organization selected');

    const { error } = await supabase
      .from('task_automation_rules')
      .delete()
      .eq('id', id)
      .eq('organization_id', currentOrganization.id);

    if (error) throw error;
    
    fetchRules();
  };

  const toggleRule = async (id: string, enabled: boolean): Promise<void> => {
    await updateRule(id, { enabled });
  };

  return {
    rules,
    loading,
    fetchRules,
    createRule,
    updateRule,
    deleteRule,
    toggleRule,
  };
}