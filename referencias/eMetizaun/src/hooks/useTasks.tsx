import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useOrganizationContext } from '@/hooks/useOrganizationContext';
import { supabase } from '@/integrations/supabase/client';

export interface Task {
  id: string;
  user_id: string;
  organization_id: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  due_date?: string;
  completed_at?: string;
  contact_id?: string;
  company_id?: string;
  deal_id?: string;
  notes?: string;
  assigned_to?: string;
  created_at: string;
  updated_at: string;
}

export type TaskInsert = Omit<Task, 'id' | 'user_id' | 'organization_id' | 'created_at' | 'updated_at'>;
export type TaskUpdate = Partial<TaskInsert>;

export const TASK_STATUSES = ["Pending", "In Progress", "Completed", "Cancelled"];
export const TASK_PRIORITIES = ["Low", "Medium", "High", "Urgent"];

export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const { user } = useAuth();
  const { currentOrganization } = useOrganizationContext();

  const fetchTasks = async () => {
    if (!user || !currentOrganization) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('organization_id', currentOrganization.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTasks(data || []);
    } catch (error) {
      console.error('Error fetching tasks:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, [user, currentOrganization]);

  const createTask = async (taskData: TaskInsert) => {
    if (!user || !currentOrganization) throw new Error('User not authenticated or no organization selected');

    const { data, error } = await supabase
      .from('tasks')
      .insert({
        ...taskData,
        user_id: user.id,
        organization_id: currentOrganization.id,
      })
      .select()
      .single();

    if (error) throw error;
    
    // Refresh tasks after creating
    fetchTasks();
    return data;
  };

  const updateTask = async (id: string, updates: TaskUpdate): Promise<Task> => {
    if (!user || !currentOrganization) throw new Error('User not authenticated or no organization selected');

    const { data, error } = await supabase
      .from('tasks')
      .update(updates)
      .eq('id', id)
      .eq('organization_id', currentOrganization.id)
      .select()
      .single();

    if (error) throw error;
    
    // Refresh tasks after updating
    fetchTasks();
    return data;
  };

  const deleteTask = async (id: string): Promise<void> => {
    if (!user || !currentOrganization) throw new Error('User not authenticated or no organization selected');

    const { error } = await supabase
      .from('tasks')
      .delete()
      .eq('id', id)
      .eq('organization_id', currentOrganization.id);

    if (error) throw error;
    
    // Refresh tasks after deleting
    fetchTasks();
  };

  const getTaskById = async (id: string): Promise<Task | null> => {
    if (!user || !currentOrganization) throw new Error('User not authenticated or no organization selected');

    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', id)
      .eq('organization_id', currentOrganization.id)
      .maybeSingle();

    if (error) throw error;
    return data;
  };

  return {
    tasks,
    loading,
    fetchTasks,
    createTask,
    updateTask,
    deleteTask,
    getTaskById,
  };
}