import { useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Building2,
  Cable,
  Clock,
  Plus,
  Shield,
  User,
  UserCheck,
  X,
  type LucideIcon,
} from "lucide-react";
import { Navigate } from "react-router-dom";

import { CompanyAccessSelect } from "@/components/admin/CompanyAccessSelect";
import { CompanyManager } from "@/components/admin/CompanyManager";
import { CreateUserModal, CreateUserFormData } from "@/components/admin/CreateUserModal";
import { InstanceAccessSelect } from "@/components/admin/InstanceAccessSelect";
import { InstanceManager } from "@/components/admin/InstanceManager";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { useCompanyAccess } from "@/hooks/useCompanyAccess";
import { useCrmUsers } from "@/hooks/useCrmUsers";
import { useInstanceAccess } from "@/hooks/useInstanceAccess";

export default function Admin() {
  const { combinedList, loading, updateUserRole, inviteUser, cancelInvitation } = useCrmUsers();
  const { userRole } = useAuth();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const {
    instances,
    memberships,
    loading: accessLoading,
    savingKeys,
    reload: reloadInstanceAccess,
    toggleInstanceAccess,
  } = useInstanceAccess(userRole === "ADMIN");
  const {
    companies,
    memberships: companyMemberships,
    loading: companyAccessLoading,
    savingKeys: companySavingKeys,
    reload: reloadCompanyAccess,
    toggleCompanyAccess,
  } = useCompanyAccess(userRole === "ADMIN");

  if (userRole !== "ADMIN") {
    return <Navigate to="/" replace />;
  }

  const getRoleBadge = (role: string, isPending: boolean) => {
    const variants: Record<string, { variant: "default" | "secondary" | "outline"; icon: LucideIcon }> = {
      ADMIN: { variant: isPending ? "outline" : "default", icon: Shield },
      VENDEDOR: { variant: isPending ? "outline" : "secondary", icon: UserCheck },
      NENHUM: { variant: "outline", icon: User },
    };
    const config = variants[role] || variants.NENHUM;
    const Icon = config.icon;

    return (
      <Badge
        variant={config.variant}
        className={isPending ? "gap-1 border-muted-foreground/50 text-muted-foreground" : "gap-1"}
      >
        <Icon className="h-3 w-3" />
        {role}
      </Badge>
    );
  };

  const handleInviteUser = async (data: CreateUserFormData) =>
    inviteUser(data.email, data.name, data.role);

  const handleRoleChange = async (
    userId: string,
    role: "VENDEDOR" | "ADMIN" | "NENHUM",
  ) => {
    await updateUserRole(userId, role);
    await Promise.all([reloadInstanceAccess(), reloadCompanyAccess()]);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold text-[var(--color-gray-900)]">
          <Shield className="h-8 w-8" />
          Administração
        </h1>
        <p className="mt-1 text-[var(--color-gray-500)]">
          Usuários, empresas e canais da operação.
        </p>
      </div>

      <Tabs defaultValue="users" className="space-y-6">
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto bg-[var(--color-bg-subtle)] p-1 sm:w-fit">
          <TabsTrigger value="users" className="gap-2">
            <UserCheck />
            Usuários e acessos
          </TabsTrigger>
          <TabsTrigger value="companies" className="gap-2">
            <Building2 />
            Empresas
          </TabsTrigger>
          <TabsTrigger value="instances" className="gap-2">
            <Cable />
            Conexões
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="mt-0">
          <Card className="overflow-hidden border-[var(--border-default)] bg-[var(--color-surface-1)] shadow-sm">
            <div className="flex flex-col gap-4 border-b border-[var(--border-default)] p-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-xl font-semibold text-[var(--color-gray-900)]">
                  <UserCheck />
                  Usuários do sistema
                </h2>
                <p className="mt-1 text-sm text-[var(--color-gray-500)]">
                  Gerencie o papel e os acessos de cada vendedor.
                </p>
              </div>
              <Button onClick={() => setIsModalOpen(true)} className="shadow-primary">
                <Plus />
                Criar usuário
              </Button>
            </div>

            <div className="overflow-x-auto p-6">
              {loading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((item) => (
                    <Skeleton key={item} className="h-16 w-full" />
                  ))}
                </div>
              ) : combinedList.length === 0 ? (
                <p className="py-8 text-center text-[var(--color-gray-500)]">
                  Nenhum usuário cadastrado
                </p>
              ) : (
                <Table className="min-w-[1120px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>E-mail</TableHead>
                      <TableHead>Papel atual</TableHead>
                      <TableHead>Instâncias</TableHead>
                      <TableHead>Empresas</TableHead>
                      <TableHead>Cadastrado em</TableHead>
                      <TableHead>Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {combinedList.map((user) => (
                      <TableRow key={user.id} className={user.isPending ? "opacity-50" : ""}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            {user.isPending ? <Clock className="text-[var(--color-gray-500)]" /> : null}
                            {user.name || "Sem nome"}
                          </div>
                        </TableCell>
                        <TableCell>{user.email}</TableCell>
                        <TableCell>{getRoleBadge(user.role, user.isPending)}</TableCell>
                        <TableCell>
                          {!user.isPending && user.role === "VENDEDOR" ? (
                            <InstanceAccessSelect
                              userId={user.id}
                              userName={user.name || user.email}
                              instances={instances}
                              memberships={memberships}
                              loading={accessLoading}
                              savingKeys={savingKeys}
                              onToggle={toggleInstanceAccess}
                            />
                          ) : (
                            <span className="text-[var(--color-gray-400)]">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {!user.isPending && user.role === "VENDEDOR" ? (
                            <CompanyAccessSelect
                              userId={user.id}
                              userName={user.name || user.email}
                              companies={companies}
                              memberships={companyMemberships}
                              loading={companyAccessLoading}
                              savingKeys={companySavingKeys}
                              onToggle={toggleCompanyAccess}
                            />
                          ) : (
                            <span className="text-[var(--color-gray-400)]">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {format(new Date(user.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}
                        </TableCell>
                        <TableCell>
                          {user.isPending ? (
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-[var(--color-gray-500)]">{user.role}</span>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void cancelInvitation(user.id)}
                                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              >
                                <X />
                                Cancelar
                              </Button>
                            </div>
                          ) : (
                            <Select
                              value={user.role}
                              onValueChange={(value) =>
                                void handleRoleChange(
                                  user.id,
                                  value as "VENDEDOR" | "ADMIN" | "NENHUM",
                                )
                              }
                            >
                              <SelectTrigger className="w-32 shadow-inset">
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
        </TabsContent>

        <TabsContent value="companies" className="mt-0">
          <CompanyManager />
        </TabsContent>

        <TabsContent value="instances" className="mt-0">
          <InstanceManager />
        </TabsContent>
      </Tabs>

      <CreateUserModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        onSubmit={handleInviteUser}
      />
    </div>
  );
}
