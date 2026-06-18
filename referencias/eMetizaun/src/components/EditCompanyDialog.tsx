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
import { Company, CompanyInsert } from "@/hooks/useCompanies";

interface EditCompanyDialogProps {
  company: Company | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEditCompany: (id: string, company: Partial<CompanyInsert>) => void;
}

export function EditCompanyDialog({ 
  company, 
  open, 
  onOpenChange, 
  onEditCompany 
}: EditCompanyDialogProps) {
  const [formData, setFormData] = useState({
    name: "",
    industry: "",
    website: "",
    phone: "",
    email: "",
    address: "",
    city: "",
    state: "",
    country: "",
    postal_code: "",
    employee_count: undefined as number | undefined,
    annual_revenue: undefined as number | undefined,
    notes: "",
  });

  useEffect(() => {
    if (company) {
      setFormData({
        name: company.name || "",
        industry: company.industry || "",
        website: company.website || "",
        phone: company.phone || "",
        email: company.email || "",
        address: company.address || "",
        city: company.city || "",
        state: company.state || "",
        country: company.country || "",
        postal_code: company.postal_code || "",
        employee_count: company.employee_count || undefined,
        annual_revenue: company.annual_revenue || undefined,
        notes: company.notes || "",
      });
    }
  }, [company]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (company) {
      onEditCompany(company.id, {
        ...formData,
        employee_count: formData.employee_count || undefined,
        annual_revenue: formData.annual_revenue || undefined,
      });
      onOpenChange(false);
    }
  };

  if (!company) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Company</DialogTitle>
          <DialogDescription>
            Update the company information below.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="edit_name">Company Name *</Label>
              <Input
                id="edit_name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit_industry">Industry</Label>
              <Input
                id="edit_industry"
                value={formData.industry}
                onChange={(e) => setFormData({ ...formData, industry: e.target.value })}
              />
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="edit_website">Website</Label>
              <Input
                id="edit_website"
                type="url"
                value={formData.website}
                onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                placeholder="https://example.com"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit_phone">Phone</Label>
              <Input
                id="edit_phone"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="edit_email">Email</Label>
            <Input
              id="edit_email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="edit_address">Address</Label>
            <Input
              id="edit_address"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="edit_city">City</Label>
              <Input
                id="edit_city"
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit_state">State</Label>
              <Input
                id="edit_state"
                value={formData.state}
                onChange={(e) => setFormData({ ...formData, state: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit_postal_code">Postal Code</Label>
              <Input
                id="edit_postal_code"
                value={formData.postal_code}
                onChange={(e) => setFormData({ ...formData, postal_code: e.target.value })}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="edit_country">Country</Label>
            <Input
              id="edit_country"
              value={formData.country}
              onChange={(e) => setFormData({ ...formData, country: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="edit_employee_count">Employee Count</Label>
              <Input
                id="edit_employee_count"
                type="number"
                value={formData.employee_count || ""}
                onChange={(e) => setFormData({ ...formData, employee_count: e.target.value ? parseInt(e.target.value) : undefined })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit_annual_revenue">Annual Revenue</Label>
              <Input
                id="edit_annual_revenue"
                type="number"
                value={formData.annual_revenue || ""}
                onChange={(e) => setFormData({ ...formData, annual_revenue: e.target.value ? parseFloat(e.target.value) : undefined })}
                placeholder="USD"
              />
            </div>
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
            <Button type="submit">Update Company</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}