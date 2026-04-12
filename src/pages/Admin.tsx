import { useState } from "react";
import { useCrmUsers } from "@/hooks/useCrmUsers";
import { useAuth } from "@/contexts/AuthContext";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Shield, UserCheck, User, Plus, Clock, X } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Navigate } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { InstanceManager } from "@/components/admin/InstanceManager";
import { CreateUserModal, CreateUserFormData } from "@/components/admin/CreateUserModal";

export default function Admin() {
  const { combinedList, loading, updateUserRole, inviteUser, cancelInvitation } = useCrmUsers();
  const { userRole } = useAuth();
  const [isModalOpen, setIsModalOpen] = useState(false);

  if (userRole !== "ADMIN") {
    return <Navigate to="/" replace />;
  }

  const getRoleBadge = (role: string, isPending: boolean) => {
    const variants: Record<string, { variant: "default" | "secondary" | "outline", icon: any }> = {
      ADMIN: { variant: isPending ? "outline" : "default", icon: Shield },
      VENDEDOR: { variant: isPending ? "outline" : "secondary", icon: UserCheck },
      NENHUM: { variant: "outline", icon: User },
    };

    const config = variants[role] || variants.NENHUM;
    const Icon = config.icon;

    return (
      <Badge 
        variant={config.variant} 
        className={isPending ? "gap-1 text-muted-foreground border-muted-foreground/50" : "gap-1"}
      >
        <Icon className="w-3 h-3" />
        {role}
      </Badge>
    );
  };

  const handleInviteUser = async (data: CreateUserFormData) => {
    const result = await inviteUser(data.email, data.name, data.role);
    return result;
  };

  const handleCancelInvitation = async (invitationId: string) => {
    await cancelInvitation(invitationId);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Shield className="w-8 h-8" />
          Administração
        </h1>
        <p className="text-muted-foreground mt-1">
          Configurações e gerenciamento do sistema
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Coluna da Esquerda: Usuários */}
        <Card className="lg:col-span-2">
          <div className="p-6 border-b border-border flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <UserCheck className="w-5 h-5" />
                Usuários do Sistema
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Aprove ou gerencie as permissões dos usuários
              </p>
            </div>
            
            {/* Botão Criar Usuário */}
            <Button 
              onClick={() => setIsModalOpen(true)}
              className="bg-emerald-500 hover:bg-emerald-600 text-white"
            >
              <Plus className="w-4 h-4 mr-2" />
              Criar Usuário
            </Button>
          </div>

          <div className="p-6">
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : combinedList.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                Nenhum usuário cadastrado
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role Atual</TableHead>
                    <TableHead>Cadastrado em</TableHead>
                    <TableHead>Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {combinedList.map((user) => (
                    <TableRow 
                      key={user.id}
                      className={user.isPending ? "opacity-50" : ""}
                    >
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {user.isPending && (
                            <Clock className="w-4 h-4 text-muted-foreground" />
                          )}
                          {user.name || "Sem nome"}
                        </div>
                      </TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell>{getRoleBadge(user.role, user.isPending)}</TableCell>
                      <TableCell>
                        {format(new Date(user.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}
                      </TableCell>
                      <TableCell>
                        {user.isPending ? (
                          // Convite pendente: mostrar role escolhida + botão cancelar
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-muted-foreground">
                              {user.role}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleCancelInvitation(user.id)}
                              className="h-8 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                            >
                              <X className="w-4 h-4 mr-1" />
                              Cancelar
                            </Button>
                          </div>
                        ) : (
                          // Usuário confirmado: select de role
                          <Select
                            value={user.role}
                            onValueChange={(value) => 
                              updateUserRole(user.id, value as "VENDEDOR" | "ADMIN" | "NENHUM")
                            }
                          >
                            <SelectTrigger className="w-32">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="NENHUM">Nenhum</SelectItem>
                              <SelectItem value="VENDEDOR">Vendedor</SelectItem>
                              <SelectItem value="ADMIN">Admin</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </Card>

        {/* Coluna Abaixo: Gerenciador de Instâncias */}
        <div className="lg:col-span-2">
          <InstanceManager />
        </div>
      </div>

      {/* Modal de Convite */}
      <CreateUserModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        onSubmit={handleInviteUser}
      />
    </div>
  );
}
