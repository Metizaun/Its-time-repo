import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { notifyLeadsUpdated } from "./useLeads";

export function useLeadOperations() {
  const createLead = async (leadData: {
    name: string;
    email?: string;
    contact_phone: string;
    source: string;
    last_city?: string;
    value?: number;
    connection_level?: string;
    notes?: string;
    stage_id?: string;
    instancia: string;
  }) => {
    try {
      if (!leadData.instancia?.trim()) {
        throw new Error("Selecione uma instancia para criar o lead.");
      }

      const { data, error: leadError } = await supabase.rpc("rpc_create_lead", {
        p_name: leadData.name,
        p_email: leadData.email || null,
        p_contact_phone: leadData.contact_phone,
        p_source: leadData.source,
        p_last_city: leadData.last_city || null,
        p_notes: leadData.notes || null,
        p_stage_id: leadData.stage_id || null,
        p_instance: leadData.instancia.trim(),
        p_value: leadData.value || null,
        p_connection_level: leadData.connection_level || null,
      });

      if (leadError) throw leadError;

      if (data && typeof data === "object" && "success" in data && data.success === false) {
        throw new Error(
          "message" in data && typeof data.message === "string"
            ? data.message
            : "Nao foi possivel criar o lead."
        );
      }

      toast.success("Lead criado com sucesso!");
      notifyLeadsUpdated();
      return { error: null };
    } catch (error: any) {
      console.error("Erro ao criar lead:", error);
      toast.error("Erro ao criar lead", {
        description: error.message,
      });
      return { error };
    }
  };

  const updateLeadStatus = async (leadId: string, newStatus: string) => {
    try {
      const { error } = await supabase.rpc("rpc_update_lead_status", {
        p_lead_id: leadId,
        p_status: newStatus,
      });

      if (error) throw error;

      toast.success("Status atualizado!");
      notifyLeadsUpdated();
      return { error: null };
    } catch (error: any) {
      console.error("Erro ao atualizar status:", error);
      toast.error("Erro ao atualizar status", {
        description: error.message,
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
      const { error } = await supabase.rpc("rpc_create_opportunity", {
        p_lead_id: opportunityData.lead_id,
        p_value: opportunityData.value,
        p_connection_level: opportunityData.connection_level,
        p_status: opportunityData.status,
      });

      if (error) throw error;

      toast.success("Oportunidade criada!");
      notifyLeadsUpdated();
      return { error: null };
    } catch (error: any) {
      console.error("Erro ao criar oportunidade:", error);
      toast.error("Erro ao criar oportunidade", {
        description: error.message,
      });
      return { error };
    }
  };

  const moveLeadToStage = async (leadId: string, stageId: string) => {
    try {
      const { error } = await supabase.rpc("rpc_move_lead_to_stage", {
        p_lead_id: leadId,
        p_stage_id: stageId,
      });

      if (error) throw error;

      toast.success("Lead movido com sucesso!");
      notifyLeadsUpdated();
      return { error: null };
    } catch (error: any) {
      console.error("Erro ao mover lead:", error);
      toast.error("Erro ao mover lead", {
        description: error.message,
      });
      return { error };
    }
  };

  return { createLead, updateLeadStatus, createOpportunity, moveLeadToStage };
}
