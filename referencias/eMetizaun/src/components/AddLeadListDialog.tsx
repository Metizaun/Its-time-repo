import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLeadLists } from '@/hooks/useLeadLists';
import { useOrganizationContext } from '@/hooks/useOrganizationContext';
import { useAuth } from '@/hooks/useAuth';
import { SmartListCriteriaBuilder, CriteriaRule } from './SmartListCriteriaBuilder';

interface AddLeadListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onListCreated?: () => void;
}

export function AddLeadListDialog({ open, onOpenChange, onListCreated }: AddLeadListDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<'static' | 'smart'>('static');
  const [criteria, setCriteria] = useState<CriteriaRule[]>([]);
  const [loading, setLoading] = useState(false);
  
  const { createLeadList } = useLeadLists();
  const { currentOrganization } = useOrganizationContext();
  const { user } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentOrganization || !user) return;

    // Validate smart list has criteria
    if (type === 'smart' && criteria.length === 0) {
      alert('Smart lists must have at least one criteria rule.');
      return;
    }

    setLoading(true);
    try {
      await createLeadList({
        user_id: user.id,
        organization_id: currentOrganization.id,
        name,
        description: description || undefined,
        type,
        criteria: type === 'smart' ? criteria : undefined,
      });

      // Reset form
      setName('');
      setDescription('');
      setType('static');
      setCriteria([]);
      
      // Notify parent and close dialog
      onListCreated?.();
      onOpenChange(false);
    } catch (error) {
      console.error('Error creating lead list:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Lead List</DialogTitle>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">List Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter list name"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="type">List Type</Label>
            <Select value={type} onValueChange={(value: 'static' | 'smart') => setType(value)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="static">Static List</SelectItem>
                <SelectItem value="smart">Smart List</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              {type === 'static' 
                ? 'Manually add and remove leads from this list'
                : 'Automatically populate based on criteria'
              }
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description (Optional)</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the purpose of this list"
              rows={3}
            />
          </div>

          {type === 'smart' && (
            <SmartListCriteriaBuilder
              criteria={criteria}
              onChange={setCriteria}
            />
          )}

          <div className="flex justify-end space-x-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !name.trim() || (type === 'smart' && criteria.length === 0)}>
              {loading ? 'Creating...' : 'Create List'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}