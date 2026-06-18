import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LeadList, useLeadLists } from '@/hooks/useLeadLists';
import { SmartListCriteriaBuilder, CriteriaRule } from './SmartListCriteriaBuilder';

interface EditLeadListDialogProps {
  list: LeadList;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditLeadListDialog({ list, open, onOpenChange }: EditLeadListDialogProps) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    type: 'static' as 'static' | 'smart',
  });
  const [criteria, setCriteria] = useState<CriteriaRule[]>([]);
  const [loading, setLoading] = useState(false);
  
  const { updateLeadList } = useLeadLists();

  useEffect(() => {
    if (list) {
      setFormData({
        name: list.name,
        description: list.description || '',
        type: list.type,
      });
      setCriteria(Array.isArray(list.criteria) ? list.criteria : []);
    }
  }, [list]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate smart list has criteria
    if (formData.type === 'smart' && criteria.length === 0) {
      alert('Smart lists must have at least one criteria rule.');
      return;
    }

    setLoading(true);
    try {
      await updateLeadList(list.id, {
        ...formData,
        criteria: formData.type === 'smart' ? criteria : null,
      });

      onOpenChange(false);
    } catch (error) {
      console.error('Error updating lead list:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Lead List</DialogTitle>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">List Name</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              placeholder="Enter list name"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="type">List Type</Label>
            <Select 
              value={formData.type} 
              onValueChange={(value: 'static' | 'smart') => setFormData(prev => ({ ...prev, type: value }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="static">Static List</SelectItem>
                <SelectItem value="smart">Smart List</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {formData.type === 'static' 
                ? 'Manually add and remove leads from this list' 
                : 'Automatically populate based on criteria'
              }
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description (Optional)</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              placeholder="Describe the purpose of this list"
              rows={3}
            />
          </div>

          {formData.type === 'smart' && (
            <SmartListCriteriaBuilder
              criteria={criteria}
              onChange={setCriteria}
            />
          )}

          <div className="flex justify-end space-x-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !formData.name.trim() || (formData.type === 'smart' && criteria.length === 0)}>
              {loading ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}