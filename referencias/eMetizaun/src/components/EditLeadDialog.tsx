import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X, Plus, List } from 'lucide-react';
import { useLeads, Lead } from '@/hooks/useLeads';
import { useLeadLists, LeadList } from '@/hooks/useLeadLists';
import { z } from 'zod';
import { useToast } from '@/hooks/use-toast';

const leadUpdateSchema = z.object({
  first_name: z.string().trim().min(1, "First name is required").max(50, "First name must be less than 50 characters"),
  last_name: z.string().trim().min(1, "Last name is required").max(50, "Last name must be less than 50 characters"),
  email: z.string().trim().email("Invalid email address").max(255, "Email must be less than 255 characters"),
  phone: z.string().trim().max(20, "Phone must be less than 20 characters").optional(),
  company: z.string().trim().max(100, "Company name must be less than 100 characters").optional(),
  title: z.string().trim().max(100, "Title must be less than 100 characters").optional(),
  industry: z.string().trim().max(50, "Industry must be less than 50 characters").optional(),
  location: z.string().trim().max(100, "Location must be less than 100 characters").optional(),
  source: z.string().trim().max(50, "Source must be less than 50 characters").optional(),
  status: z.string().min(1, "Status is required"),
  score: z.number().min(0, "Score must be at least 0").max(100, "Score must be at most 100"),
  notes: z.string().trim().max(1000, "Notes must be less than 1000 characters").optional(),
});

type LeadUpdate = z.infer<typeof leadUpdateSchema>;

interface EditLeadDialogProps {
  lead: Lead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditLeadDialog({ lead, open, onOpenChange }: EditLeadDialogProps) {
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { updateLead } = useLeads();
  const { toast } = useToast();
  const { leadLists: allLeadLists, addLeadToList, removeLeadFromList, getListsForLead } = useLeadLists();

  const [currentLeadLists, setCurrentLeadLists] = useState<LeadList[]>([]);
  const [selectedListToAdd, setSelectedListToAdd] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [showDropdown, setShowDropdown] = useState<boolean>(false);
  const [loadingLists, setLoadingLists] = useState(false);
  const [pendingListChanges, setPendingListChanges] = useState<{
    toAdd: string[];
    toRemove: string[];
  }>({ toAdd: [], toRemove: [] });

  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    company: '',
    title: '',
    industry: '',
    location: '',
    source: '',
    status: 'New',
    score: 0,
    notes: '',
  });

  useEffect(() => {
    if (lead) {
      setFormData({
        first_name: lead.first_name || '',
        last_name: lead.last_name || '',
        email: lead.email || '',
        phone: lead.phone || '',
        company: lead.company || '',
        title: lead.title || '',
        industry: lead.industry || '',
        location: lead.location || '',
        source: lead.source || '',
        status: lead.status || 'New',
        score: lead.score || 0,
        notes: lead.notes || '',
      });
    }
  }, [lead]);

  useEffect(() => {
    const fetchLeadLists = async () => {
      if (lead && open) {
        setLoadingLists(true);
        try {
          const lists = await getListsForLead(lead.id);
          setCurrentLeadLists(lists);
          // Reset pending changes when dialog opens
          setPendingListChanges({ toAdd: [], toRemove: [] });
        } catch (error) {
          console.error('Error fetching lead lists:', error);
        } finally {
          setLoadingLists(false);
        }
      }
    };

    fetchLeadLists();
  }, [lead, open]); // Removed getListsForLead from dependencies

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lead) return;

    // Clear previous errors
    setErrors({});

    // Validate form data
    try {
      const validatedData = leadUpdateSchema.parse({
        ...formData,
        phone: formData.phone || undefined,
        company: formData.company || undefined,
        title: formData.title || undefined,
        industry: formData.industry || undefined,
        location: formData.location || undefined,
        source: formData.source || undefined,
        notes: formData.notes || undefined,
      });

      setLoading(true);

      // Update the lead
      await updateLead(lead.id, validatedData);

      // Apply pending list changes
      if (pendingListChanges.toAdd.length > 0) {
        for (const listId of pendingListChanges.toAdd) {
          await addLeadToList(lead.id, listId);
        }
      }

      if (pendingListChanges.toRemove.length > 0) {
        for (const listId of pendingListChanges.toRemove) {
          await removeLeadFromList(lead.id, listId);
        }
      }

      // Refresh the current lists to reflect the changes
      const updatedLists = await getListsForLead(lead.id);
      setCurrentLeadLists(updatedLists);
      setPendingListChanges({ toAdd: [], toRemove: [] });

      onOpenChange(false);
      setErrors({});

      toast({
        title: "Success",
        description: "Lead updated successfully",
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        const newErrors: Record<string, string> = {};
        error.errors.forEach((err) => {
          if (err.path[0]) {
            newErrors[err.path[0] as string] = err.message;
          }
        });
        setErrors(newErrors);
      } else {
        toast({
          title: "Error",
          description: "Failed to update lead",
          variant: "destructive",
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setErrors({});
    setCurrentLeadLists([]);
    setSelectedListToAdd('');
    setSearchTerm('');
    setShowDropdown(false);
    setPendingListChanges({ toAdd: [], toRemove: [] });
    onOpenChange(false);
  };

  const handleAddToList = (listId?: string) => {
    const targetListId = listId || selectedListToAdd;
    if (!lead || !targetListId) return;

    // Find the list to add
    const listToAdd = allLeadLists.find(list => list.id === targetListId);
    if (!listToAdd) return;

    // Add to pending changes
    setPendingListChanges(prev => ({
      ...prev,
      toAdd: [...prev.toAdd, targetListId],
      // Remove from toRemove if it was previously marked for removal
      toRemove: prev.toRemove.filter(id => id !== targetListId)
    }));

    // Update current lists immediately for better UX
    setCurrentLeadLists(prev => [...prev, listToAdd]);
    setSelectedListToAdd('');
    setSearchTerm('');
    setShowDropdown(false);
  };

  const handleRemoveFromList = (listId: string) => {
    if (!lead) return;

    // Add to pending changes
    setPendingListChanges(prev => ({
      ...prev,
      toRemove: [...prev.toRemove, listId],
      // Remove from toAdd if it was previously marked for addition
      toAdd: prev.toAdd.filter(id => id !== listId)
    }));

    // Update current lists immediately for better UX
    setCurrentLeadLists(prev => prev.filter(list => list.id !== listId));
  };

  // Get available lists that the lead is not already in
  const availableListsToAdd = allLeadLists.filter(list =>
    !currentLeadLists.some(currentList => currentList.id === list.id)
  );

  // Filter lists based on search term
  const filteredLists = availableListsToAdd.filter(list =>
    list.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Lead</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="first_name">First Name</Label>
              <Input
                id="first_name"
                value={formData.first_name}
                onChange={(e) => setFormData(prev => ({ ...prev, first_name: e.target.value }))}
                required
                className={errors.first_name ? "border-destructive" : ""}
              />
              {errors.first_name && (
                <p className="text-sm text-destructive">{errors.first_name}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="last_name">Last Name</Label>
              <Input
                id="last_name"
                value={formData.last_name}
                onChange={(e) => setFormData(prev => ({ ...prev, last_name: e.target.value }))}
                required
                className={errors.last_name ? "border-destructive" : ""}
              />
              {errors.last_name && (
                <p className="text-sm text-destructive">{errors.last_name}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
              required
              className={errors.email ? "border-destructive" : ""}
            />
            {errors.email && (
              <p className="text-sm text-destructive">{errors.email}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={formData.phone}
                onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="company">Company</Label>
              <Input
                id="company"
                value={formData.company}
                onChange={(e) => setFormData(prev => ({ ...prev, company: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="industry">Industry</Label>
              <Input
                id="industry"
                value={formData.industry}
                onChange={(e) => setFormData(prev => ({ ...prev, industry: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="location">Location</Label>
              <Input
                id="location"
                value={formData.location}
                onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="source">Source</Label>
              <Select
                value={formData.source}
                onValueChange={(value) => setFormData(prev => ({ ...prev, source: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select source" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Website">Website</SelectItem>
                  <SelectItem value="Referral">Referral</SelectItem>
                  <SelectItem value="Social Media">Social Media</SelectItem>
                  <SelectItem value="Advertisement">Advertisement</SelectItem>
                  <SelectItem value="Trade Show">Trade Show</SelectItem>
                  <SelectItem value="Cold Call">Cold Call</SelectItem>
                  <SelectItem value="Email Campaign">Email Campaign</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select
                value={formData.status}
                onValueChange={(value) => setFormData(prev => ({ ...prev, status: value }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="New">New</SelectItem>
                  <SelectItem value="Contacted">Contacted</SelectItem>
                  <SelectItem value="Qualified">Qualified</SelectItem>
                  <SelectItem value="Unqualified">Unqualified</SelectItem>
                  <SelectItem value="Lost">Lost</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="score">Lead Score</Label>
              <Input
                id="score"
                type="number"
                min="0"
                max="100"
                value={formData.score}
                onChange={(e) => setFormData(prev => ({ ...prev, score: parseInt(e.target.value) || 0 }))}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
              rows={3}
            />
          </div>

          <Separator />

          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <List className="h-4 w-4" />
              <Label className="text-base font-semibold">Lists</Label>
            </div>

            {loadingLists ? (
              <div className="text-center py-4">
                <p className="text-sm text-muted-foreground">Loading lists...</p>
              </div>
            ) : (
              <>
                {/* Add to new list - SELECTION */}
                <div className="space-y-2">
                  <Label className="text-sm text-muted-foreground">Add to List</Label>
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <div className="flex-1 relative">
                        <input
                          type="text"
                          placeholder="Search lists..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          onFocus={() => setShowDropdown(true)}
                          onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                          className="w-full px-3 py-2 border border-input bg-background text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md"
                        />
                        {(searchTerm || showDropdown) && (
                          <div className="absolute z-10 w-full mt-1 bg-popover border border-border rounded-md shadow-md max-h-60 overflow-auto">
                            {filteredLists.length > 0 ? (
                              filteredLists.map((list) => (
                                <div
                                  key={list.id}
                                  className="px-3 py-2 hover:bg-accent cursor-pointer flex items-center justify-between"
                                  onClick={() => {
                                    handleAddToList(list.id);
                                    setShowDropdown(false);
                                  }}
                                >
                                  <span>{list.name}</span>
                                  <Badge variant={list.type === 'smart' ? 'default' : 'outline'} className="text-xs">
                                    {list.type === 'smart' ? 'Smart' : 'Static'}
                                  </Badge>
                                </div>
                              ))
                            ) : (
                              <div className="px-3 py-2 text-sm text-muted-foreground">
                                No lists found
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => searchTerm && handleAddToList()}
                        disabled={!selectedListToAdd}
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        Add
                      </Button>
                    </div>
                    {availableListsToAdd.length === 0 && !searchTerm && (
                      <p className="text-sm text-muted-foreground">
                        This lead is already in all available lists.
                      </p>
                    )}
                  </div>
                </div>

                {/* Current lists */}
                <div className="space-y-2">
                  <Label className="text-sm text-muted-foreground">Lists ({currentLeadLists.length})</Label>
                  <div className="flex flex-wrap gap-2">
                    {currentLeadLists.map((list) => (
                      <Badge key={list.id} variant="secondary" className="flex items-center gap-1">
                        {list.name}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-4 w-4 p-0 hover:bg-destructive hover:text-destructive-foreground"
                          onClick={() => handleRemoveFromList(list.id)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </Badge>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Updating...' : 'Update Lead'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
