import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Task, TaskInsert, TASK_STATUSES, TASK_PRIORITIES } from "@/hooks/useTasks";
import { useContacts } from "@/hooks/useContacts";
import { useCompanies } from "@/hooks/useCompanies";
import { useDeals } from "@/hooks/useDeals";
import { supabase } from "@/integrations/supabase/client";
import { useOrganizationContext } from "@/hooks/useOrganizationContext";

interface EditTaskDialogProps {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEditTask: (id: string, task: Partial<TaskInsert>) => void;
}

export function EditTaskDialog({ 
  task, 
  open, 
  onOpenChange, 
  onEditTask 
}: EditTaskDialogProps) {
  const [contacts, setContacts] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [deals, setDeals] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const { fetchContacts } = useContacts();
  const { fetchCompanies } = useCompanies();
  const { fetchDeals } = useDeals();
  const { currentOrganization } = useOrganizationContext();
  
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    status: "Pending",
    priority: "Medium",
    due_date: "",
    contact_id: "",
    company_id: "",
    deal_id: "",
    notes: "",
    assigned_to: "",
  });

  useEffect(() => {
    if (open) {
      loadRelatedData();
    }
  }, [open]);

  useEffect(() => {
    if (task) {
      setFormData({
        title: task.title || "",
        description: task.description || "",
        status: task.status || "Pending",
        priority: task.priority || "Medium",
        due_date: task.due_date || "",
        contact_id: task.contact_id || "",
        company_id: task.company_id || "",
        deal_id: task.deal_id || "",
        notes: task.notes || "",
        assigned_to: task.assigned_to || "",
      });
    }
  }, [task]);

  const loadRelatedData = async () => {
    try {
      const [contactsData, companiesData, dealsData] = await Promise.all([
        fetchContacts(),
        fetchCompanies(),
        fetchDeals()
      ]);
      setContacts(contactsData);
      setCompanies(companiesData);
      setDeals(dealsData);

      // Fetch organization users
      if (currentOrganization?.id) {
        // First get user roles, then fetch profiles separately to avoid relation issues
        const { data: userRoles, error: rolesError } = await supabase
          .from('user_roles')
          .select('id, user_id, role')
          .eq('organization_id', currentOrganization.id);

        if (rolesError) {
          console.error('Error fetching user roles:', rolesError);
        } else if (userRoles) {
          // Get unique user IDs
          const userIds = userRoles.map(ur => ur.user_id);
          
          // Fetch profiles for these users
          const { data: profiles, error: profilesError } = await supabase
            .from('profiles')
            .select('user_id, display_name')
            .in('user_id', userIds);

          if (profilesError) {
            console.error('Error fetching profiles:', profilesError);
          } else {
            // Combine the data
            const usersData = userRoles.map((ur: any) => {
              const profile = profiles?.find(p => p.user_id === ur.user_id);
              return {
                id: ur.user_id,
                display_name: profile?.display_name || 'Unknown User',
                role: ur.role
              };
            });
            setUsers(usersData);
            console.log('Loaded users for assignment:', usersData);
          }
        }
      }
    } catch (error) {
      console.error('Failed to load related data:', error);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (task) {
      onEditTask(task.id, {
        ...formData,
        contact_id: formData.contact_id === "none" ? undefined : formData.contact_id || undefined,
        company_id: formData.company_id === "none" ? undefined : formData.company_id || undefined,
        deal_id: formData.deal_id === "none" ? undefined : formData.deal_id || undefined,
        due_date: formData.due_date || undefined,
        assigned_to: formData.assigned_to === "none" ? undefined : formData.assigned_to || undefined,
      });
      onOpenChange(false);
    }
  };

  if (!task) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Task</DialogTitle>
          <DialogDescription>
            Update the task information below.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="edit_title">Task Title *</Label>
            <Input
              id="edit_title"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              required
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="edit_description">Description</Label>
            <Textarea
              id="edit_description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="edit_status">Status</Label>
              <Select value={formData.status} onValueChange={(value) => setFormData({ ...formData, status: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit_priority">Priority</Label>
              <Select value={formData.priority} onValueChange={(value) => setFormData({ ...formData, priority: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_PRIORITIES.map((priority) => (
                    <SelectItem key={priority} value={priority}>
                      {priority}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="edit_due_date">Due Date</Label>
            <Input
              id="edit_due_date"
              type="date"
              value={formData.due_date}
              onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="edit_assigned_to">Assign To</Label>
            <Select value={formData.assigned_to} onValueChange={(value) => setFormData({ ...formData, assigned_to: value })}>
              <SelectTrigger>
                <SelectValue placeholder="Select assignee" />
              </SelectTrigger>
              <SelectContent className="bg-background border shadow-md z-50">
                <SelectItem value="none">Unassigned</SelectItem>
                {users.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="edit_contact_id">Contact</Label>
              <Select value={formData.contact_id} onValueChange={(value) => setFormData({ ...formData, contact_id: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select contact" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No contact</SelectItem>
                  {contacts.map((contact) => (
                    <SelectItem key={contact.id} value={contact.id}>
                      {contact.first_name} {contact.last_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit_company_id">Company</Label>
              <Select value={formData.company_id} onValueChange={(value) => setFormData({ ...formData, company_id: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select company" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No company</SelectItem>
                  {companies.map((company) => (
                    <SelectItem key={company.id} value={company.id}>
                      {company.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit_deal_id">Deal</Label>
              <Select value={formData.deal_id} onValueChange={(value) => setFormData({ ...formData, deal_id: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select deal" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No deal</SelectItem>
                  {deals.map((deal) => (
                    <SelectItem key={deal.id} value={deal.id}>
                      {deal.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="edit_notes">Notes</Label>
            <Textarea
              id="edit_notes"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
            />
          </div>

          <div className="flex justify-end space-x-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Update Task</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}