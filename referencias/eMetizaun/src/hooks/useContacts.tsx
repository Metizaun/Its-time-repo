import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { useOrganizationContext } from "./useOrganizationContext";

export interface Contact {
  id: string;
  user_id: string;
  organization_id: string;
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  company?: string;
  company_id?: string;
  position?: string;
  notes?: string;
  birthday?: string;
  anniversary?: string;
  personal_notes?: string;
  important_dates?: { label: string; date: string }[];
  created_at: string;
  updated_at: string;
}

export type ContactInsert = Omit<Contact, 'id' | 'user_id' | 'organization_id' | 'created_at' | 'updated_at'>;
export type ContactUpdate = Partial<ContactInsert>;

export const useContacts = () => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const { currentOrganization } = useOrganizationContext();

  const fetchContacts = useCallback(async (): Promise<Contact[]> => {
    if (!user || !currentOrganization) return [];

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('contacts')
        .select('*')
        .eq('organization_id', currentOrganization.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const contactsData = (data || []).map(contact => ({
        ...contact,
        important_dates: contact.important_dates ?
          (Array.isArray(contact.important_dates) ? contact.important_dates : []) :
          undefined
      })) as Contact[];
      setContacts(contactsData);
      return contactsData;
    } catch (error) {
      console.error('Error fetching contacts:', error);
      return [];
    } finally {
      setLoading(false);
    }
  }, [user, currentOrganization]);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  const createContact = async (contact: ContactInsert): Promise<Contact> => {
    if (!user || !currentOrganization) throw new Error('User not authenticated or no organization selected');

    const { data, error } = await supabase
      .from('contacts')
      .insert({
        ...contact,
        user_id: user.id,
        organization_id: currentOrganization.id,
      })
      .select()
      .single();

    if (error) throw error;

    const contactData = {
      ...data,
      important_dates: data.important_dates ? 
        (Array.isArray(data.important_dates) ? data.important_dates : []) :
        undefined
    } as Contact;
    setContacts(prev => [contactData, ...prev]);
    return contactData;
  };

  const updateContact = async (id: string, updates: ContactUpdate): Promise<Contact> => {
    if (!user || !currentOrganization) throw new Error('User not authenticated or no organization selected');

    const { data, error } = await supabase
      .from('contacts')
      .update(updates)
      .eq('id', id)
      .eq('organization_id', currentOrganization.id)
      .select()
      .single();

    if (error) throw error;

    const contactData = {
      ...data,
      important_dates: data.important_dates ? 
        (Array.isArray(data.important_dates) ? data.important_dates : []) :
        undefined
    } as Contact;
    setContacts(prev => prev.map(contact => contact.id === contactData.id ? contactData : contact));
    return contactData;
  };

  const deleteContact = async (id: string): Promise<void> => {
    if (!user || !currentOrganization) throw new Error('User not authenticated or no organization selected');

    const { error } = await supabase
      .from('contacts')
      .delete()
      .eq('id', id)
      .eq('organization_id', currentOrganization.id);

    if (error) throw error;

    setContacts(prev => prev.filter(contact => contact.id !== id));
  };

  const getContactById = async (id: string): Promise<Contact | null> => {
    if (!user || !currentOrganization) throw new Error('User not authenticated or no organization selected');

    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .eq('id', id)
      .eq('organization_id', currentOrganization.id)
      .maybeSingle();

    if (error) throw error;
    return data ? {
      ...data,
      important_dates: data.important_dates ? 
        (Array.isArray(data.important_dates) ? data.important_dates : []) :
        undefined
    } as Contact : null;
  };

  return {
    contacts,
    loading,
    fetchContacts,
    createContact,
    updateContact,
    deleteContact,
    getContactById,
  };
};