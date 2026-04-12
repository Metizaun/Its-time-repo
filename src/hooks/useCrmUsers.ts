import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface CrmUser {
  id: string;
  auth_user_id: string;
  email: string;
  name: string | null;
  role: "NENHUM" | "VENDEDOR" | "ADMIN";
  created_at: string;
}

export interface PendingInvitation {
  id: string;
  email: string;
  name: string | null;
  role: string;
  invited_at: string;
  expires_at: string;
  days_until_expiry: number;
}

// Interface unificada para usuários confirmados + pendentes
export interface CombinedUserOrInvitation {
  id: string;
  email: string;
  name: string | null;
  role: "NENHUM" | "VENDEDOR" | "ADMIN";
  created_at: string;
  isPending: boolean;
}

export function useCrmUsers() {
  const [users, setUsers] = useState<CrmUser[]>([]);
  const [pendingInvitations, setPendingInvitations] = useState<PendingInvitation[]>([]);
  const [combinedList, setCombinedList] = useState<CombinedUserOrInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [invitationsLoading, setInvitationsLoading] = useState(false);

  // Buscar usuários existentes
  const fetchUsers = async () => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      setUsers(data || []);
    } catch (error: any) {
      console.error("Erro ao carregar usuários:", error);
      toast.error("Erro ao carregar usuários", {
        description: error.message
      });
    } finally {
      setLoading(false);
    }
  };

  // Buscar convites pendentes
  const fetchPendingInvitations = async () => {
    setInvitationsLoading(true);
    try {
      const { data, error } = await supabase
        .rpc('get_pending_invitations');

      if (error) throw error;

      setPendingInvitations(data || []);
    } catch (error: any) {
      console.error("Erro ao carregar convites:", error);
      toast.error("Erro ao carregar convites", {
        description: error.message
      });
    } finally {
      setInvitationsLoading(false);
    }
  };

  // Combinar usuários confirmados + convites pendentes
  useEffect(() => {
    const confirmed: CombinedUserOrInvitation[] = users.map(user => ({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      created_at: user.created_at,
      isPending: false,
    }));

    const pending: CombinedUserOrInvitation[] = pendingInvitations.map(inv => ({
      id: inv.id,
      email: inv.email,
      name: inv.name,
      role: inv.role as "NENHUM" | "VENDEDOR" | "ADMIN",
      created_at: inv.invited_at,
      isPending: true,
    }));

    // Ordenar por data (mais recentes primeiro)
    const combined = [...confirmed, ...pending].sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    setCombinedList(combined);
  }, [users, pendingInvitations]);

  // Atualizar role de usuário existente
  const updateUserRole = async (userId: string, newRole: "VENDEDOR" | "ADMIN" | "NENHUM") => {
    try {
      const { error } = await supabase
        .from('users')
        .update({ role: newRole })
        .eq('id', userId);

      if (error) throw error;

      toast.success("Role atualizada com sucesso!");
      fetchUsers();
    } catch (error: any) {
      console.error("Erro ao atualizar role:", error);
      toast.error("Erro ao atualizar role", {
        description: error.message
      });
    }
  };

  // Convidar novo usuário
  const inviteUser = async (email: string, name: string, role: "VENDEDOR" | "ADMIN" | "NENHUM") => {
    try {
      // 1. Criar convite no banco
      const { data, error } = await supabase
        .rpc('invite_user_to_company', {
          p_email: email,
          p_name: name,
          p_role: role
        });

      if (error) throw error;

      // Verificar se a função retornou erro
      if (data && !data.success) {
        throw new Error(data.error || 'Erro ao criar convite');
      }

      const invitationId = data.invitation_id;

      // 2. Chamar Edge Function para enviar email
      const { data: edgeData, error: edgeError } = await supabase.functions.invoke(
        'send-user-invitation',
        {
          body: { 
            email, 
            invitationId 
          }
        }
      );

      if (edgeError) {
        console.error('Erro ao enviar email:', edgeError);
        throw new Error('Convite criado, mas falha ao enviar email. Tente reenviar.');
      }

      if (edgeData && !edgeData.success) {
        throw new Error(edgeData.error || 'Erro ao enviar email');
      }

      toast.success("Convite enviado com sucesso!", {
        description: "O usuário receberá um email para completar o cadastro."
      });

      // Atualizar lista de convites
      fetchPendingInvitations();
      
      return { success: true };
    } catch (error: any) {
      console.error("Erro ao convidar usuário:", error);
      toast.error("Erro ao convidar usuário", {
        description: error.message
      });
      return { success: false, error: error.message };
    }
  };

  // Cancelar convite pendente
  const cancelInvitation = async (invitationId: string) => {
    try {
      const { data, error } = await supabase
        .rpc('cancel_invitation', {
          p_invitation_id: invitationId
        });

      if (error) throw error;

      // Verificar se a função retornou erro
      if (data && !data.success) {
        throw new Error(data.error || 'Erro ao cancelar convite');
      }

      toast.success("Convite cancelado com sucesso!");

      // Atualizar lista de convites
      fetchPendingInvitations();
      
      return { success: true };
    } catch (error: any) {
      console.error("Erro ao cancelar convite:", error);
      toast.error("Erro ao cancelar convite", {
        description: error.message
      });
      return { success: false, error: error.message };
    }
  };

  useEffect(() => {
    fetchUsers();
    fetchPendingInvitations();
  }, []);

  return { 
    // Listas separadas (caso precise)
    users, 
    pendingInvitations,
    
    // Lista unificada (USAR ESSA NO ADMIN)
    combinedList,
    
    // Estados
    loading, 
    invitationsLoading,
    
    // Ações
    updateUserRole, 
    inviteUser,
    cancelInvitation,
    
    // Refresh
    refetch: fetchUsers,
    refreshInvitations: fetchPendingInvitations,
  };
}