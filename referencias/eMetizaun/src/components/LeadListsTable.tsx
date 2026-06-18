import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MoreHorizontal, Edit, Trash2, Users } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { LeadList, useLeadLists } from '@/hooks/useLeadLists';
import { formatDistanceToNow } from 'date-fns';
import { EditLeadListDialog } from './EditLeadListDialog';
import { LeadListMembersDialog } from './LeadListMembersDialog';

interface LeadListsTableProps {
  lists: LeadList[];
  loading: boolean;
  onSelectList?: (list: LeadList) => void;
}

export function LeadListsTable({ lists, loading, onSelectList }: LeadListsTableProps) {
  const [editingList, setEditingList] = useState<LeadList | null>(null);
  const [viewingMembers, setViewingMembers] = useState<LeadList | null>(null);
  const { deleteLeadList } = useLeadLists();

  const handleDelete = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this lead list? This action cannot be undone.')) {
      await deleteLeadList(id);
    }
  };

  const handleListSelect = (list: LeadList) => {
    if (onSelectList) {
      onSelectList(list);
    }
  };

  if (loading) {
    return <div className="text-center py-8">Loading lead lists...</div>;
  }

  if (lists.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">No lead lists found. Create your first list to get started.</p>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-[70px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lists.map((list) => (
              <TableRow
                key={list.id}
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => handleListSelect(list)}
              >
                <TableCell className="font-medium">{list.name}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Badge variant={list.type === 'smart' ? 'default' : 'secondary'}>
                      {list.type === 'smart' ? 'Smart' : 'Static'}
                    </Badge>
                    {list.type === 'smart' && (
                      <span className="text-xs text-muted-foreground">Auto-updates</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {list.description || 'No description'}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDistanceToNow(new Date(list.created_at), { addSuffix: true })}
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" className="h-8 w-8 p-0">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setViewingMembers(list); }}>
                        <Users className="mr-2 h-4 w-4" />
                        View Members
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setEditingList(list); }}>
                        <Edit className="mr-2 h-4 w-4" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={(e) => { e.stopPropagation(); handleDelete(list.id); }}
                        className="text-destructive"
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {editingList && (
        <EditLeadListDialog
          list={editingList}
          open={!!editingList}
          onOpenChange={(open) => !open && setEditingList(null)}
        />
      )}

      {viewingMembers && (
        <LeadListMembersDialog
          list={viewingMembers}
          open={!!viewingMembers}
          onOpenChange={(open) => !open && setViewingMembers(null)}
        />
      )}
    </>
  );
}