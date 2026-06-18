import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Plus, Users, ArrowLeft, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AddLeadListDialog } from '@/components/AddLeadListDialog';
import { ImportLeadsDialog } from '@/components/ImportLeadsDialog';
import { LeadListsTable } from '@/components/LeadListsTable';
import { useLeadLists } from '@/hooks/useLeadLists';
import { useLeads, Lead } from '@/hooks/useLeads';
import { formatDistanceToNow } from 'date-fns';
import { AddLeadsToListDialog } from '@/components/AddLeadsToListDialog';

interface LeadListMember {
  id: string;
  lead_id: string;
  list_id: string;
  added_by: string;
  added_at: string;
  leads: Lead;
}

export default function Lists() {
  const navigate = useNavigate();
  const [showAddListDialog, setShowAddListDialog] = useState(false);
  const [showAddLeadsDialog, setShowAddLeadsDialog] = useState(false);
  const [selectedList, setSelectedList] = useState<any>(null);
  const [listMembers, setListMembers] = useState<LeadListMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);

  const { leadLists, loading: listsLoading, getListMembers, removeLeadFromList, fetchLeadLists } = useLeadLists();
  const { leads, loading: leadsLoading, createLead } = useLeads();

  const fetchListMembers = async (listId: string) => {
    setMembersLoading(true);
    try {
      const data = await getListMembers(listId) as LeadListMember[];
      setListMembers(data);
    } catch (error) {
      console.error('Error fetching members:', error);
    } finally {
      setMembersLoading(false);
    }
  };

  const handleRemoveMember = async (leadId: string) => {
    if (!selectedList) return;
    if (window.confirm('Are you sure you want to remove this lead from the list?')) {
      await removeLeadFromList(leadId, selectedList.id);
      fetchListMembers(selectedList.id); // Refresh the list
    }
  };

  const handleBackToLists = () => {
    setSelectedList(null);
    setListMembers([]);
  };

  useEffect(() => {
    if (selectedList) {
      fetchListMembers(selectedList.id);
    }
  }, [selectedList]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Lead Lists</h1>
          <p className="text-muted-foreground">
            Organize your leads into targeted lists for better campaign management.
          </p>
        </div>
        <div className="flex gap-2">
          {selectedList && selectedList.type === 'static' && (
            <>
              <ImportLeadsDialog onImportLeads={async (importedLeads) => {
                for (const leadData of importedLeads) {
                  try {
                    await createLead(leadData);
                  } catch (error) {
                    console.error('Failed to import lead:', error);
                  }
                }
              }} />
              <Button onClick={() => setShowAddLeadsDialog(true)}>
                <Users className="h-4 w-4 mr-2" />
                Add Leads
              </Button>
            </>
          )}
          <Button onClick={() => setShowAddListDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New List
          </Button>
        </div>
      </div>

      {selectedList ? (
        // Show selected list members
        <div>
          <div className="flex items-center gap-4 mb-6">
            <Button variant="ghost" size="sm" onClick={handleBackToLists}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Lists
            </Button>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold">
                {selectedList.name}
              </h2>
              <Badge variant="secondary">
                {listMembers.length} leads
              </Badge>
              <Badge variant={selectedList.type === 'smart' ? 'default' : 'outline'}>
                {selectedList.type === 'smart' ? 'Smart List' : 'Static List'}
              </Badge>
            </div>
          </div>

          {membersLoading ? (
            <div className="text-center py-8">Loading members...</div>
          ) : listMembers.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground mb-4">
                {selectedList.type === 'smart'
                  ? 'No leads match the smart list criteria yet.'
                  : 'No leads in this list yet.'
                }
              </p>
              {selectedList.type === 'static' && (
                <Button onClick={() => setShowAddLeadsDialog(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Leads
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {selectedList.type === 'static' && (
                <div className="flex justify-between items-center">
                  <div></div>
                  <Button onClick={() => setShowAddLeadsDialog(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Leads
                  </Button>
                </div>
              )}

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
                    {listMembers.map((member) => (
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
                          {selectedList.type === 'static' ? (
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

              {selectedList.type === 'smart' && (
                <div className="text-sm text-muted-foreground">
                  This smart list automatically updates based on criteria
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        // Show all lists
        <>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold">All Lists</h2>
            <div className="text-sm text-muted-foreground">
              {leadLists.length} lists managing {leads.length} leads
            </div>
          </div>

          <LeadListsTable
            lists={leadLists}
            loading={listsLoading}
            onSelectList={setSelectedList}
          />
        </>
      )}

      <AddLeadListDialog
        open={showAddListDialog}
        onOpenChange={setShowAddListDialog}
        onListCreated={() => fetchLeadLists()}
      />

      {selectedList && selectedList.type === 'static' && (
        <AddLeadsToListDialog
          list={selectedList}
          open={showAddLeadsDialog}
          onOpenChange={setShowAddLeadsDialog}
          onLeadsAdded={() => selectedList && fetchListMembers(selectedList.id)}
        />
      )}
    </div>
  );
}
