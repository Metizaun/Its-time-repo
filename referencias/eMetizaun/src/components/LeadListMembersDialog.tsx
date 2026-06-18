import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Trash2, Plus } from 'lucide-react';
import { LeadList, useLeadLists } from '@/hooks/useLeadLists';
import { Lead } from '@/hooks/useLeads';
import { formatDistanceToNow } from 'date-fns';
import { AddLeadsToListDialog } from './AddLeadsToListDialog';

interface LeadListMember {
  id: string;
  lead_id: string;
  list_id: string;
  added_by: string;
  added_at: string;
  leads: Lead;
}

interface LeadListMembersDialogProps {
  list: LeadList;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LeadListMembersDialog({ list, open, onOpenChange }: LeadListMembersDialogProps) {
  const [members, setMembers] = useState<LeadListMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddLeadsDialog, setShowAddLeadsDialog] = useState(false);
  const { getListMembers, removeLeadFromList } = useLeadLists();

  const fetchMembers = async () => {
    setLoading(true);
    try {
      const data = await getListMembers(list.id) as LeadListMember[];
      setMembers(data);
    } catch (error) {
      console.error('Error fetching members:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveMember = async (leadId: string) => {
    if (window.confirm('Are you sure you want to remove this lead from the list?')) {
      await removeLeadFromList(leadId, list.id);
      fetchMembers(); // Refresh the list
    }
  };

  useEffect(() => {
    if (open) {
      fetchMembers();
    }
  }, [open, list.id]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[800px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Members of "{list.name}"
            <Badge variant="secondary" className="ml-2">
              {members.length} leads
            </Badge>
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          {loading ? (
            <div className="text-center py-8">Loading members...</div>
          ) : members.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground mb-4">
                {list.type === 'smart' 
                  ? 'No leads match the smart list criteria yet.' 
                  : 'No leads in this list yet.'
                }
              </p>
              {list.type === 'static' && (
                <Button onClick={() => setShowAddLeadsDialog(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Leads
                </Button>
              )}
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Added</TableHead>
                    <TableHead className="w-[70px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map((member) => (
                    <TableRow key={member.id}>
                      <TableCell className="font-medium">
                        {member.leads.first_name} {member.leads.last_name}
                      </TableCell>
                      <TableCell>{member.leads.email}</TableCell>
                      <TableCell>{member.leads.company || '-'}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{member.leads.status}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDistanceToNow(new Date(member.added_at), { addSuffix: true })}
                      </TableCell>
                      <TableCell>
                        {list.type === 'static' ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveMember(member.leads.id)}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">Auto-added</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        <div className="flex justify-between">
          {members.length > 0 && list.type === 'static' && (
            <Button onClick={() => setShowAddLeadsDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add More Leads
            </Button>
          )}
          {list.type === 'smart' && (
            <div className="text-sm text-muted-foreground">
              This smart list automatically updates based on criteria
            </div>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>

      {list.type === 'static' && (
        <AddLeadsToListDialog
          list={list}
          open={showAddLeadsDialog}
          onOpenChange={setShowAddLeadsDialog}
          onLeadsAdded={fetchMembers}
        />
      )}
    </Dialog>
  );
}