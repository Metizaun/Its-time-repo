import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CompanyInsert } from "@/hooks/useCompanies";

interface AddCompanyDialogProps {
  onAddCompany: (company: CompanyInsert) => void;
}

export function AddCompanyDialog({ onAddCompany }: AddCompanyDialogProps) {
  const [open, setOpen] = useState(false);
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

  const normalizeWebsite = (url: string) => {
    if (!url) return "";
    
    // Remove any existing protocol
    let normalized = url.replace(/^https?:\/\//, "");
    
    // If it doesn't start with www. and doesn't contain a dot, add www.
    if (!normalized.startsWith("www.") && !normalized.includes(".")) {
      normalized = `www.${normalized}.com`;
    } else if (!normalized.startsWith("www.") && normalized.includes(".")) {
      // If it has a dot but no www, add www
      normalized = `www.${normalized}`;
    }
    
    // Add https protocol
    return `https://${normalized}`;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onAddCompany({
      ...formData,
      website: formData.website ? normalizeWebsite(formData.website) : undefined,
      employee_count: formData.employee_count || undefined,
      annual_revenue: formData.annual_revenue || undefined,
    });
    setFormData({
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
      employee_count: undefined,
      annual_revenue: undefined,
      notes: "",
    });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Add Company
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add New Company</DialogTitle>
          <DialogDescription>
            Add a new company to your CRM. Fill in the details below.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Company Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="industry">Industry</Label>
              <Input
                id="industry"
                value={formData.industry}
                onChange={(e) => setFormData({ ...formData, industry: e.target.value })}
              />
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="website">Website</Label>
              <Input
                id="website"
                value={formData.website}
                onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                placeholder="example.com or www.example.com"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="address">Address</Label>
            <Input
              id="address"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="state">State</Label>
              <Input
                id="state"
                value={formData.state}
                onChange={(e) => setFormData({ ...formData, state: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="postal_code">Postal Code</Label>
              <Input
                id="postal_code"
                value={formData.postal_code}
                onChange={(e) => setFormData({ ...formData, postal_code: e.target.value })}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="country">Country</Label>
            <Input
              id="country"
              value={formData.country}
              onChange={(e) => setFormData({ ...formData, country: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="employee_count">Employee Count</Label>
              <Input
                id="employee_count"
                type="number"
                value={formData.employee_count || ""}
                onChange={(e) => setFormData({ ...formData, employee_count: e.target.value ? parseInt(e.target.value) : undefined })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="annual_revenue">Annual Revenue</Label>
              <Input
                id="annual_revenue"
                type="number"
                value={formData.annual_revenue || ""}
                onChange={(e) => setFormData({ ...formData, annual_revenue: e.target.value ? parseFloat(e.target.value) : undefined })}
                placeholder="USD"
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
            />
          </div>

          <div className="flex justify-end space-x-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Add Company</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}