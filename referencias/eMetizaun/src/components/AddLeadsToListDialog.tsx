import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Search } from 'lucide-react';
import { useLeads, Lead } from '@/hooks/useLeads';
import { useLeadLists, LeadList } from '@/hooks/useLeadLists';

interface AddLeadsToListDialogProps {
  list: LeadList;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLeadsAdded?: () => void;
}

export function AddLeadsToListDialog({ list, open, onOpenChange, onLeadsAdded }: AddLeadsToListDialogProps) {
  const [selectedLeads, setSelectedLeads] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const { leads, fetchLeads } = useLeads();
  const { addLeadToList, getListMembers } = useLeadLists();
  const [availableLeads, setAvailableLeads] = useState<Lead[]>([]);

  useEffect(() => {
    if (open) {
      fetchLeads();
    }
  }, [open, fetchLeads]);

  useEffect(() => {
    const filterAvailableLeads = async () => {
      if (!leads.length) return;

      try {
        // Get current list members to exclude them
        const members = await getListMembers(list.id);
        const memberLeadIds = members.map((member: any) => member.lead_id);
        
        // Filter out leads that are already in the list
        const filtered = leads.filter(lead => !memberLeadIds.includes(lead.id));
        
        // Apply search filter
        const searchFiltered = filtered.filter(lead =>
          lead.first_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          lead.last_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          lead.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (lead.company && lead.company.toLowerCase().includes(searchTerm.toLowerCase()))
        );
        
        setAvailableLeads(searchFiltered);
      } catch (error) {
        console.error('Error filtering leads:', error);
        setAvailableLeads([]);
      }
    };

    filterAvailableLeads();
  }, [leads, list.id, searchTerm, getListMembers]);

  const handleLeadToggle = (leadId: string) => {
    setSelectedLeads(prev =>
      prev.includes(leadId)
        ? prev.filter(id => id !== leadId)
        : [...prev, leadId]
    );
  };

  const handleSelectAll = () => {
    if (selectedLeads.length === availableLeads.length) {
      setSelectedLeads([]);
    } else {
      setSelectedLeads(availableLeads.map(lead => lead.id));
    }
  };

  const handleAddLeads = async () => {
    if (!selectedLeads.length) return;

    setLoading(true);
    try {
      // Add each selected lead to the list
      await Promise.all(
        selectedLeads.map(leadId => addLeadToList(leadId, list.id))
      );

      setSelectedLeads([]);
      onOpenChange(false);
      onLeadsAdded?.();
    } catch (error) {
      console.error('Error adding leads to list:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[800px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Leads to "{list.name}"</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder="Search leads..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>

          {availableLeads.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">
                {searchTerm ? 'No leads found matching your search.' : 'No leads available to add.'}
              </p>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50px]">
                      <Checkbox
                        checked={selectedLeads.length === availableLeads.length}
                        onCheckedChange={handleSelectAll}
                      />
                    </TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {availableLeads.map((lead) => (
                    <TableRow key={lead.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedLeads.includes(lead.id)}
                          onCheckedChange={() => handleLeadToggle(lead.id)}
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        {lead.first_name} {lead.last_name}
                      </TableCell>
                      <TableCell>{lead.email}</TableCell>
                      <TableCell>{lead.company || '-'}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{lead.status}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">
              {selectedLeads.length} lead{selectedLeads.length !== 1 ? 's' : ''} selected
            </p>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleAddLeads}
                disabled={!selectedLeads.length || loading}
              >
                {loading ? 'Adding...' : `Add ${selectedLeads.length} Lead${selectedLeads.length !== 1 ? 's' : ''}`}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}