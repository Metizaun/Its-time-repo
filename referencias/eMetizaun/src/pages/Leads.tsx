import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Plus, LayoutGrid, Grid3X3, Search } from 'lucide-react';
import { AddLeadDialog } from '@/components/AddLeadDialog';
import { EditLeadDialog } from '@/components/EditLeadDialog';
import { LeadsTable } from '@/components/LeadsTable';
import { ImportLeadsDialog } from '@/components/ImportLeadsDialog';
import { LeadsKanban } from '@/components/LeadsKanban';
import { useLeads, Lead } from '@/hooks/useLeads';
import { useOrganizationContext } from '@/hooks/useOrganizationContext';

export default function Leads() {
  const [showAddLeadDialog, setShowAddLeadDialog] = useState(false);
  const [showEditLeadDialog, setShowEditLeadDialog] = useState(false);
  const [selectedLeadForEdit, setSelectedLeadForEdit] = useState<Lead | null>(null);
  const [viewMode, setViewMode] = useState<'table' | 'kanban'>('table');
  const [searchTerm, setSearchTerm] = useState("");

  const { leads, loading: leadsLoading, updateLead, deleteLead, createLead, fetchLeads } = useLeads();
  const { currentOrganization, loading: orgLoading } = useOrganizationContext();

  // Apply search filter
  const filteredLeads = leads.filter(lead => {
    const fullName = `${lead.first_name} ${lead.last_name}`;
    const matchesSearch = 
      fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (lead.email || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (lead.company || '').toLowerCase().includes(searchTerm.toLowerCase());
    
    return matchesSearch;
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Leads</h1>
          <p className="text-muted-foreground">
            Manage and track your sales leads.
          </p>
        </div>
        <div className="flex gap-2">
          <ImportLeadsDialog onImportLeads={async (importedLeads) => {
            for (const leadData of importedLeads) {
              try {
                await createLead(leadData);
              } catch (error) {
                console.error('Failed to import lead:', error);
              }
            }
            await fetchLeads();
          }} />
          <Button onClick={() => setShowAddLeadDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Lead
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                <Input
                  placeholder="Search leads..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 w-80"
                />
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex rounded-lg border p-1">
                <Button
                  variant={viewMode === 'table' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('table')}
                  className="h-8 px-3"
                >
                  <Grid3X3 className="h-4 w-4 mr-2" />
                  Table
                </Button>
                <Button
                  variant={viewMode === 'kanban' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('kanban')}
                  className="h-8 px-3"
                >
                  <LayoutGrid className="h-4 w-4 mr-2" />
                  Kanban
                </Button>
              </div>
              {filteredLeads.length > 0 && (
                <div className="text-sm text-muted-foreground">
                  {filteredLeads.length} leads
                </div>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {viewMode === 'table' ? (
            <LeadsTable
              leads={filteredLeads}
              allLeads={leads}
              loading={leadsLoading || orgLoading}
              onEditLead={(lead) => {
                setSelectedLeadForEdit(lead);
                setShowEditLeadDialog(true);
              }}
              updateLead={updateLead}
              deleteLead={deleteLead}
            />
          ) : (
            <div className="h-[600px] w-full overflow-hidden">
              <LeadsKanban
                leads={filteredLeads}
                loading={leadsLoading}
                onUpdateLead={updateLead}
                onEditLead={(lead) => {
                  setSelectedLeadForEdit(lead);
                  setShowEditLeadDialog(true);
                }}
                onViewLead={(lead) => {
                  // TODO: Implement view lead functionality
                  console.log('View lead:', lead);
                }}
                onDeleteLead={deleteLead}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <AddLeadDialog
        open={showAddLeadDialog}
        onOpenChange={setShowAddLeadDialog}
        onLeadCreated={fetchLeads}
      />

      <EditLeadDialog
        lead={selectedLeadForEdit}
        open={showEditLeadDialog}
        onOpenChange={(open) => {
          setShowEditLeadDialog(open);
          if (!open) setSelectedLeadForEdit(null);
        }}
      />
    </div>
  );
}