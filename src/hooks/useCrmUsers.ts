import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getCrmBackend, patchCrmBackend, postCrmBackend } from "@/services/crmBackend";

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

  const fetchUsers = async () => {
    try {
      const { users: nextUsers } = await getCrmBackend<{ users: CrmUser[] }>("/api/admin/users");
      setUsers(nextUsers || []);
    } catch (error: any) {
      console.error("Erro ao carregar usuarios:", error);
      toast.error("Erro ao carregar usuarios", {
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchPendingInvitations = async () => {
    setInvitationsLoading(true);
    try {
      const { invitations } = await getCrmBackend<{ invitations: PendingInvitation[] }>(
        "/api/admin/invitations/pending"
      );
      setPendingInvitations(invitations || []);
    } catch (error: any) {
      console.error("Erro ao carregar convites:", error);
      toast.error("Erro ao carregar convites", {
        description: error.message,
      });
    } finally {
      setInvitationsLoading(false);
    }
  };

  useEffect(() => {
    const confirmed: CombinedUserOrInvitation[] = users.map((user) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      created_at: user.created_at,
      isPending: false,
    }));

    const pending: CombinedUserOrInvitation[] = pendingInvitations.map((invitation) => ({
      id: invitation.id,
      email: invitation.email,
      name: invitation.name,
      role: invitation.role as "NENHUM" | "VENDEDOR" | "ADMIN",
      created_at: invitation.invited_at,
      isPending: true,
    }));

    const combined = [...confirmed, ...pending].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    setCombinedList(combined);
  }, [users, pendingInvitations]);

  const updateUserRole = async (userId: string, newRole: "VENDEDOR" | "ADMIN" | "NENHUM") => {
    try {
      await patchCrmBackend(`/api/admin/users/${encodeURIComponent(userId)}/role`, {
        role: newRole,
      });

      toast.success("Role atualizada com sucesso!");
      await fetchUsers();
    } catch (error: any) {
      console.error("Erro ao atualizar role:", error);
      toast.error("Erro ao atualizar role", {
        description: error.message,
      });
    }
  };

  const inviteUser = async (email: string, name: string, role: "VENDEDOR" | "ADMIN" | "NENHUM") => {
    try {
      await postCrmBackend("/api/admin/users/invite", { email, name, role });

      toast.success("Convite enviado com sucesso!", {
        description: "O usuario recebera um email para completar o cadastro.",
      });

      await fetchPendingInvitations();

      return { success: true };
    } catch (error: any) {
      console.error("Erro ao convidar usuario:", error);
      toast.error("Erro ao convidar usuario", {
        description: error.message,
      });
      return { success: false, error: error.message };
    }
  };

  const cancelInvitation = async (invitationId: string) => {
    try {
      await postCrmBackend(`/api/admin/invitations/${encodeURIComponent(invitationId)}/cancel`, {});

      toast.success("Convite cancelado com sucesso!");
      await fetchPendingInvitations();

      return { success: true };
    } catch (error: any) {
      console.error("Erro ao cancelar convite:", error);
      toast.error("Erro ao cancelar convite", {
        description: error.message,
      });
      return { success: false, error: error.message };
    }
  };

  useEffect(() => {
    void fetchUsers();
    void fetchPendingInvitations();
  }, []);

  return {
    users,
    pendingInvitations,
    combinedList,
    loading,
    invitationsLoading,
    updateUserRole,
    inviteUser,
    cancelInvitation,
    refetch: fetchUsers,
    refreshInvitations: fetchPendingInvitations,
  };
}
