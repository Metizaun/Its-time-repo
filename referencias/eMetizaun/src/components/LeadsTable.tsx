import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MoreHorizontal, Edit, Trash2 } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Lead } from '@/hooks/useLeads';
import { formatDistanceToNow } from 'date-fns';

const STATUS_OPTIONS = ['New', 'Contacted', 'Qualified', 'Unqualified', 'Lost'];

interface LeadsTableProps {
  leads: Lead[];
  allLeads: Lead[];
  loading: boolean;
  onAddLead?: () => void;
  onEditLead?: (lead: Lead) => void;
  updateLead?: (id: string, updates: Partial<Lead>) => Promise<Lead>;
  deleteLead?: (id: string) => Promise<void>;
}

export function LeadsTable({ leads, allLeads, loading, onAddLead, onEditLead, updateLead, deleteLead }: LeadsTableProps) {

  const handleDelete = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this lead? This action cannot be undone.')) {
      await deleteLead?.(id);
    }
  };

  const handleStatusChange = async (leadId: string, newStatus: string) => {
    try {
      await updateLead?.(leadId, { status: newStatus });
    } catch (error) {
      console.error('Error updating lead status:', error);
    }
  };

  const getStatusVariant = (status: string) => {
    switch (status) {
      case 'New': return 'default';
      case 'Contacted': return 'secondary';
      case 'Qualified': return 'success';
      case 'Unqualified': return 'outline';
      case 'Lost': return 'destructive';
      default: return 'outline';
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-yellow-600';
    if (score >= 40) return 'text-orange-600';
    return 'text-red-600';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Company</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Source</TableHead>
          <TableHead>Score</TableHead>
          <TableHead>Created</TableHead>
          <TableHead className="w-[50px]"></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {leads.length === 0 ? (
          <TableRow>
            <TableCell colSpan={8} className="text-center py-8">
              <div className="flex flex-col items-center space-y-4">
                <p className="text-muted-foreground">No leads found.</p>
                <p className="text-sm text-muted-foreground">
                  Add your first lead to get started with your pipeline.
                </p>
              </div>
            </TableCell>
          </TableRow>
        ) : (
          leads.map((lead) => (
            <TableRow key={lead.id}>
              <TableCell className="font-medium">
                <div>
                  <div className="font-medium">
                    {lead.first_name} {lead.last_name}
                  </div>
                  {lead.title && (
                    <div className="text-sm text-muted-foreground">{lead.title}</div>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <div>
                  <div>{lead.email}</div>
                  {lead.phone && (
                    <div className="text-sm text-muted-foreground">{lead.phone}</div>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <div>
                  <div>{lead.company || '-'}</div>
                  {lead.industry && (
                    <div className="text-sm text-muted-foreground">{lead.industry}</div>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <Select 
                  value={lead.status} 
                  onValueChange={(value) => handleStatusChange(lead.id, value)}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue>
                      <Badge variant={getStatusVariant(lead.status) as any}>
                        {lead.status}
                      </Badge>
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map(status => (
                      <SelectItem key={status} value={status}>
                        <Badge variant={getStatusVariant(status) as any}>
                          {status}
                        </Badge>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                {lead.source ? (
                  <Badge variant="outline">{lead.source}</Badge>
                ) : (
                  '-'
                )}
              </TableCell>
              <TableCell>
                <span className={`font-medium ${getScoreColor(lead.score)}`}>
                  {lead.score}
                </span>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDistanceToNow(new Date(lead.created_at), { addSuffix: true })}
              </TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="h-8 w-8 p-0">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onEditLead?.(lead)}>
                      <Edit className="mr-2 h-4 w-4" />
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleDelete(lead.id)}
                      className="text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}