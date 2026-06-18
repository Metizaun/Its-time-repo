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
import { Deal, DealInsert, DEAL_STAGES, DEAL_STATUSES } from "@/hooks/useDeals";
import { useContacts } from "@/hooks/useContacts";
import { useCompanies } from "@/hooks/useCompanies";

interface EditDealDialogProps {
  deal: Deal | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEditDeal: (id: string, deal: Partial<DealInsert>) => void;
}

export function EditDealDialog({ 
  deal, 
  open, 
  onOpenChange, 
  onEditDeal 
}: EditDealDialogProps) {
  const [contacts, setContacts] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const { fetchContacts } = useContacts();
  const { fetchCompanies } = useCompanies();
  
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    value: undefined as number | undefined,
    status: "Active",
    stage: "Prospecting",
    probability: 50,
    contact_id: "",
    company_id: "",
    expected_close_date: "",
    notes: "",
  });

  useEffect(() => {
    if (open) {
      loadRelatedData();
    }
  }, [open]);

  useEffect(() => {
    if (deal) {
      setFormData({
        title: deal.title || "",
        description: deal.description || "",
        value: deal.value || undefined,
        status: deal.status || "Active",
        stage: deal.stage || "Prospecting",
        probability: deal.probability || 50,
        contact_id: deal.contact_id || "",
        company_id: deal.company_id || "",
        expected_close_date: deal.expected_close_date || "",
        notes: deal.notes || "",
      });
    }
  }, [deal]);

  const loadRelatedData = async () => {
    try {
      const [contactsData, companiesData] = await Promise.all([
        fetchContacts(),
        fetchCompanies()
      ]);
      setContacts(contactsData);
      setCompanies(companiesData);
    } catch (error) {
      console.error('Failed to load related data:', error);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (deal) {
      onEditDeal(deal.id, {
        ...formData,
        value: formData.value || undefined,
        contact_id: formData.contact_id === "none" ? undefined : formData.contact_id || undefined,
        company_id: formData.company_id === "none" ? undefined : formData.company_id || undefined,
        expected_close_date: formData.expected_close_date || undefined,
      });
      onOpenChange(false);
    }
  };

  if (!deal) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Deal</DialogTitle>
          <DialogDescription>
            Update the deal information below.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="edit_title">Deal Title *</Label>
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
              <Label htmlFor="edit_value">Deal Value (USD)</Label>
              <Input
                id="edit_value"
                type="number"
                step="0.01"
                value={formData.value || ""}
                onChange={(e) => setFormData({ ...formData, value: e.target.value ? parseFloat(e.target.value) : undefined })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit_probability">Probability (%)</Label>
              <Input
                id="edit_probability"
                type="number"
                min="0"
                max="100"
                value={formData.probability}
                onChange={(e) => setFormData({ ...formData, probability: parseInt(e.target.value) || 50 })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="edit_status">Status</Label>
              <Select value={formData.status} onValueChange={(value) => setFormData({ ...formData, status: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DEAL_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit_stage">Stage</Label>
              <Select value={formData.stage} onValueChange={(value) => setFormData({ ...formData, stage: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DEAL_STAGES.map((stage) => (
                    <SelectItem key={stage} value={stage}>
                      {stage}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
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
          </div>

          <div className="grid gap-2">
            <Label htmlFor="edit_expected_close_date">Expected Close Date</Label>
            <Input
              id="edit_expected_close_date"
              type="date"
              value={formData.expected_close_date}
              onChange={(e) => setFormData({ ...formData, expected_close_date: e.target.value })}
            />
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
            <Button type="submit">Update Deal</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}