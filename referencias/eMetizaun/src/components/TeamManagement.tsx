import { useState, useEffect } from "react";
import { Plus, Users, Shield, Eye, Crown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useOrganizations, OrganizationMember, UserRole } from "@/hooks/useOrganizations";
import { useOrganizationContext } from "@/hooks/useOrganizationContext";
import { useAuth } from "@/hooks/useAuth";
import { CreateUserDialog } from "@/components/CreateUserDialog";
import { useToast } from "@/hooks/use-toast";

export function TeamManagement() {
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [createUserDialogOpen, setCreateUserDialogOpen] = useState(false);
  const [removeUserId, setRemoveUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  
  const { currentOrganization } = useOrganizationContext();
  const { user } = useAuth();
  const { 
    fetchOrganizationMembers, 
    updateUserRole, 
    removeUser,
    getUserRole 
  } = useOrganizations();
  const { toast } = useToast();

  const [currentUserRole, setCurrentUserRole] = useState<UserRole['role'] | null>(null);

  useEffect(() => {
    if (currentOrganization) {
      loadMembers();
      loadCurrentUserRole();
    }
  }, [currentOrganization]);

  const loadCurrentUserRole = async () => {
    if (!currentOrganization || !user) return;
    
    try {
      const role = await getUserRole(currentOrganization.id);
      setCurrentUserRole(role);
    } catch (error) {
      console.error('Failed to get user role:', error);
    }
  };

  const loadMembers = async () => {
    if (!currentOrganization) return;
    
    try {
      setLoading(true);
      console.log('Loading members for organization:', currentOrganization.id);
      const data = await fetchOrganizationMembers(currentOrganization.id);
      console.log('Fetched members:', data);
      setMembers(data);
    } catch (error: any) {
      console.error('Failed to load members:', error);
      toast({
        title: "Error",
        description: "Failed to load team members",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRoleChange = async (memberId: string, newRole: UserRole['role']) => {
    try {
      await updateUserRole(memberId, newRole);
      toast({
        title: "Success",
        description: "User role updated successfully",
      });
      loadMembers();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update user role",
        variant: "destructive",
      });
    }
  };

  const handleRemoveUser = async () => {
    if (!removeUserId) return;
    
    try {
      await removeUser(removeUserId);
      toast({
        title: "Success",
        description: "User removed from organization",
      });
      setRemoveUserId(null);
      loadMembers();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to remove user",
        variant: "destructive",
      });
    }
  };

  const getRoleIcon = (role: UserRole['role']) => {
    switch (role) {
      case 'owner':
        return <Crown className="h-4 w-4" />;
      case 'admin':
        return <Shield className="h-4 w-4" />;
      case 'member':
        return <Users className="h-4 w-4" />;
      case 'viewer':
        return <Eye className="h-4 w-4" />;
      default:
        return null;
    }
  };

  const getRoleBadgeVariant = (role: UserRole['role']) => {
    switch (role) {
      case 'owner':
        return 'default';
      case 'admin':
        return 'secondary';
      case 'member':
        return 'outline';
      case 'viewer':
        return 'outline';
      default:
        return 'outline';
    }
  };

  const canManageUser = (targetRole: UserRole['role'], isCurrentUser: boolean) => {
    if (isCurrentUser) return false;
    if (!currentUserRole) return false;
    
    // Owner can manage anyone except themselves
    if (currentUserRole === 'owner') return !isCurrentUser;
    
    // Admin can manage members and viewers, but not other admins or owner
    if (currentUserRole === 'admin') {
      return targetRole === 'member' || targetRole === 'viewer';
    }
    
    return false;
  };

  if (!currentOrganization) {
    return <div>No organization selected</div>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Team Members
              </CardTitle>
              <CardDescription>
                Manage users and their roles in {currentOrganization.name}
              </CardDescription>
            </div>
            {(currentUserRole === 'owner' || currentUserRole === 'admin') && (
              <Button onClick={() => setCreateUserDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Create User
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8">Loading team members...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => {
                  const isCurrentUser = member.user_id === user?.id;
                  const canManage = canManageUser(member.role, isCurrentUser);
                  
                  return (
                    <TableRow key={member.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span>{member.profiles.display_name || 'Unknown User'}</span>
                          {isCurrentUser && <Badge variant="outline">You</Badge>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={getRoleBadgeVariant(member.role)} className="flex items-center gap-1 w-fit">
                          {getRoleIcon(member.role)}
                          {member.role.charAt(0).toUpperCase() + member.role.slice(1)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {canManage && (
                            <>
                              <Select
                                value={member.role}
                                onValueChange={(value) => handleRoleChange(member.id, value as UserRole['role'])}
                              >
                                <SelectTrigger className="w-32">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="member">Member</SelectItem>
                                  {currentUserRole === 'owner' && (
                                    <SelectItem value="admin">Admin</SelectItem>
                                  )}
                                </SelectContent>
                              </Select>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => setRemoveUserId(member.id)}
                              >
                                Remove
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CreateUserDialog
        open={createUserDialogOpen}
        onOpenChange={setCreateUserDialogOpen}
        organizationId={currentOrganization.id}
        onUserCreated={loadMembers}
      />

      <AlertDialog open={!!removeUserId} onOpenChange={() => setRemoveUserId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove User</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove this user from the organization?
              They will lose access to all data and won't be able to log in.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemoveUser}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}