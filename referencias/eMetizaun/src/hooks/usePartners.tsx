import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useOrganizationContext } from './useOrganizationContext';
import { useToast } from './use-toast';

export interface Partner {
  id: string;
  user_id: string;
  organization_id: string;
  name: string;
  company_name?: string;
  email?: string;
  phone?: string;
  website?: string;
  industry?: string;
  address?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
  contact_person?: string;
  partnership_type?: string;
  status: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface PartnerInsert {
  name: string;
  company_name?: string;
  email?: string;
  phone?: string;
  website?: string;
  industry?: string;
  address?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
  contact_person?: string;
  partnership_type?: string;
  status?: string;
  notes?: string;
}

export interface PartnerContract {
  id: string;
  partner_id: string;
  user_id: string;
  organization_id: string;
  title: string;
  contract_number?: string;
  contract_type?: string;
  status: string;
  start_date?: string;
  end_date?: string;
  renewal_date?: string;
  contract_value?: number;
  currency?: string;
  payment_terms?: string;
  description?: string;
  file_url?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface PartnerContractInsert {
  partner_id: string;
  title: string;
  contract_number?: string;
  contract_type?: string;
  status?: string;
  start_date?: string;
  end_date?: string;
  renewal_date?: string;
  contract_value?: number;
  currency?: string;
  payment_terms?: string;
  description?: string;
  file_url?: string;
  notes?: string;
}

export const usePartners = () => {
  const { user } = useAuth();
  const { currentOrganization } = useOrganizationContext();
  const { toast } = useToast();

  const fetchPartners = async (): Promise<Partner[]> => {
    if (!user || !currentOrganization) {
      throw new Error('User not authenticated or organization not selected');
    }

    const { data, error } = await supabase
      .from('partners')
      .select('*')
      .eq('organization_id', currentOrganization.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching partners:', error);
      throw error;
    }

    return data || [];
  };

  const fetchPartnerContracts = async (partnerId?: string): Promise<PartnerContract[]> => {
    if (!user || !currentOrganization) {
      throw new Error('User not authenticated or organization not selected');
    }

    let query = supabase
      .from('partner_contracts')
      .select('*')
      .eq('organization_id', currentOrganization.id);

    if (partnerId) {
      query = query.eq('partner_id', partnerId);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching partner contracts:', error);
      throw error;
    }

    return data || [];
  };

  const createPartner = async (partnerData: PartnerInsert): Promise<Partner> => {
    if (!user || !currentOrganization) {
      throw new Error('User not authenticated or organization not selected');
    }

    const { data, error } = await supabase
      .from('partners')
      .insert({
        ...partnerData,
        user_id: user.id,
        organization_id: currentOrganization.id,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating partner:', error);
      throw error;
    }

    return data;
  };

  const createPartnerContract = async (contractData: PartnerContractInsert): Promise<PartnerContract> => {
    if (!user || !currentOrganization) {
      throw new Error('User not authenticated or organization not selected');
    }

    const { data, error } = await supabase
      .from('partner_contracts')
      .insert({
        ...contractData,
        user_id: user.id,
        organization_id: currentOrganization.id,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating partner contract:', error);
      throw error;
    }

    return data;
  };

  const updatePartner = async (id: string, partnerData: Partial<PartnerInsert>): Promise<Partner> => {
    const { data, error } = await supabase
      .from('partners')
      .update(partnerData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating partner:', error);
      throw error;
    }

    return data;
  };

  const updatePartnerContract = async (id: string, contractData: Partial<PartnerContractInsert>): Promise<PartnerContract> => {
    const { data, error } = await supabase
      .from('partner_contracts')
      .update(contractData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating partner contract:', error);
      throw error;
    }

    return data;
  };

  const deletePartner = async (id: string): Promise<void> => {
    const { error } = await supabase
      .from('partners')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting partner:', error);
      throw error;
    }
  };

  const deletePartnerContract = async (id: string): Promise<void> => {
    const { error } = await supabase
      .from('partner_contracts')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting partner contract:', error);
      throw error;
    }
  };

  const uploadContractFile = async (contractId: string, file: File): Promise<string> => {
    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}.${fileExt}`;
    const filePath = `${contractId}/${fileName}`;

    const { data, error } = await supabase.storage
      .from('partner-contracts')
      .upload(filePath, file);

    if (error) {
      console.error('Error uploading file:', error);
      throw error;
    }

    // Update the contract with the file path
    const { error: updateError } = await supabase
      .from('partner_contracts')
      .update({ file_url: data.path })
      .eq('id', contractId);

    if (updateError) {
      console.error('Error updating contract with file path:', updateError);
      throw updateError;
    }

    return data.path;
  };

  const downloadContractFile = async (filePath: string): Promise<Blob> => {
    const { data, error } = await supabase.storage
      .from('partner-contracts')
      .download(filePath);

    if (error) {
      console.error('Error downloading file:', error);
      throw error;
    }

    return data;
  };

  const deleteContractFile = async (filePath: string): Promise<void> => {
    const { error } = await supabase.storage
      .from('partner-contracts')
      .remove([filePath]);

    if (error) {
      console.error('Error deleting file:', error);
      throw error;
    }
  };

  const getContractFileUrl = (filePath: string): string => {
    const { data } = supabase.storage
      .from('partner-contracts')
      .getPublicUrl(filePath);

    return data.publicUrl;
  };

  return {
    fetchPartners,
    fetchPartnerContracts,
    createPartner,
    createPartnerContract,
    updatePartner,
    updatePartnerContract,
    deletePartner,
    deletePartnerContract,
    uploadContractFile,
    downloadContractFile,
    deleteContractFile,
    getContractFileUrl,
  };
};