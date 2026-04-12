import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { notifyLeadsUpdated } from "./useLeads";

export function useLeadOperations() {
  const createLead = async (leadData: {
    name: string;
    email?: string; // Tornado opcional
    contact_phone: string;
    source: string;
    last_city?: string;
    status?: string;
    value?: number;
    connection_level?: string;
    owner_id?: string;
    notes?: string;
    stage_id?: string;
  }) => {
    try {
      // Criar lead
      const { data: newLead, error: leadError } = await supabase
        .from('leads')
        .insert({
          name: leadData.name,
          email: leadData.email || null, // Se vier string vazia ou undefined, salva como null
          contact_phone: leadData.contact_phone,
          "Fonte": leadData.source,
          last_city: leadData.last_city || null,
          status: leadData.status || 'Aberto',
          stage_id: leadData.stage_id || null,
          owner_id: leadData.owner_id || null,
          notes: leadData.notes || null,
        })
        .select()
        .single();

      if (leadError) throw leadError;

      // Guarantee the selected pipeline stage after insert.
      // Some DB-side sync logic can remap stage based on status/category.
      if (newLead && leadData.stage_id) {
        const { error: moveError } = await supabase.rpc("rpc_move_lead_to_stage", {
          p_lead_id: newLead.id,
          p_stage_id: leadData.stage_id,
        });
        if (moveError) throw moveError;
      }

      // Se houver valor ou conexão, criar opportunity
      if (newLead && (leadData.value || leadData.connection_level)) {
        const { error: oppError } = await supabase.rpc('rpc_create_opportunity', {
          p_lead_id: newLead.id,
          p_value: leadData.value || null,
          p_connection_level: leadData.connection_level || null,
          p_status: leadData.status || 'Aberto'
        });

        if (oppError) throw oppError;
      }

      toast.success("Lead criado com sucesso!");
      notifyLeadsUpdated();
      return { error: null };
    } catch (error: any) {
      console.error("Erro ao criar lead:", error);
      toast.error("Erro ao criar lead", {
        description: error.message
      });
      return { error };
    }
  };

  const updateLeadStatus = async (leadId: string, newStatus: string) => {
    try {
      const { error } = await supabase.rpc('rpc_update_lead_status', {
        p_lead_id: leadId,
        p_status: newStatus
      });

      if (error) throw error;

      toast.success("Status atualizado!");
      notifyLeadsUpdated();
      return { error: null };
    } catch (error: any) {
      console.error("Erro ao atualizar status:", error);
      toast.error("Erro ao atualizar status", {
        description: error.message
      });
      return { error };
    }
  };

  const createOpportunity = async (opportunityData: {
    lead_id: string;
    value: number;
    connection_level: string;
    status: string;
  }) => {
    try {
      const { error } = await supabase.rpc('rpc_create_opportunity', {
        p_lead_id: opportunityData.lead_id,
        p_value: opportunityData.value,
        p_connection_level: opportunityData.connection_level,
        p_status: opportunityData.status
      });

      if (error) throw error;

      toast.success("Oportunidade criada!");
      notifyLeadsUpdated();
      return { error: null };
    } catch (error: any) {
      console.error("Erro ao criar oportunidade:", error);
      toast.error("Erro ao criar oportunidade", {
        description: error.message
      });
      return { error };
    }
  };

  const moveLeadToStage = async (leadId: string, stageId: string) => {
    try {
      const { error } = await supabase.rpc('rpc_move_lead_to_stage', {
        p_lead_id: leadId,
        p_stage_id: stageId
      });

      if (error) throw error;

      toast.success("Lead movido com sucesso!");
      notifyLeadsUpdated();
      return { error: null };
    } catch (error: any) {
      console.error("Erro ao mover lead:", error);
      toast.error("Erro ao mover lead", {
        description: error.message
      });
      return { error };
    }
  };

  return { createLead, updateLeadStatus, createOpportunity, moveLeadToStage };
}
