import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PartnerInsert } from "@/hooks/usePartners";
import { z } from "zod";

const partnerSchema = z.object({
  name: z.string()
    .min(1, { message: "Partner name is required" })
    .max(100, { message: "Partner name must be less than 100 characters" }),
  company_name: z.string()
    .max(100, { message: "Company name must be less than 100 characters" })
    .optional(),
  email: z.string()
    .email({ message: "Please enter a valid email address" })
    .max(255, { message: "Email must be less than 255 characters" })
    .optional()
    .or(z.literal("")),
  phone: z.string()
    .max(20, { message: "Phone number must be less than 20 characters" })
    .optional(),
  website: z.string()
    .url({ message: "Please enter a valid website URL" })
    .max(255, { message: "Website URL must be less than 255 characters" })
    .optional()
    .or(z.literal("")),
  industry: z.string()
    .max(100, { message: "Industry must be less than 100 characters" })
    .optional(),
  address: z.string()
    .max(255, { message: "Address must be less than 255 characters" })
    .optional(),
  city: z.string()
    .max(100, { message: "City must be less than 100 characters" })
    .optional(),
  state: z.string()
    .max(50, { message: "State must be less than 50 characters" })
    .optional(),
  postal_code: z.string()
    .max(20, { message: "Postal code must be less than 20 characters" })
    .optional(),
  country: z.string()
    .max(100, { message: "Country must be less than 100 characters" })
    .optional(),
  contact_person: z.string()
    .max(100, { message: "Contact person name must be less than 100 characters" })
    .optional(),
  partnership_type: z.string().optional(),
  status: z.string().optional(),
  notes: z.string()
    .max(1000, { message: "Notes must be less than 1000 characters" })
    .optional(),
});

interface AddPartnerDialogProps {
  onAddPartner: (partner: PartnerInsert) => void;
}

export function AddPartnerDialog({ onAddPartner }: AddPartnerDialogProps) {
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState<PartnerInsert>({
    name: "",
    company_name: "",
    email: "",
    phone: "",
    website: "",
    industry: "",
    address: "",
    city: "",
    state: "",
    postal_code: "",
    country: "",
    contact_person: "",
    partnership_type: "",
    status: "active",
    notes: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    try {
      // Clean empty strings to undefined, but preserve required fields
      const cleanedData: Partial<PartnerInsert> = {};
      Object.entries(formData).forEach(([key, value]) => {
        if (key === 'name' || (value !== "" && value !== undefined)) {
          cleanedData[key as keyof PartnerInsert] = value;
        }
      });

      const validatedData = partnerSchema.parse(cleanedData) as PartnerInsert;
      onAddPartner(validatedData);
      setOpen(false);
      setFormData({
        name: "",
        company_name: "",
        email: "",
        phone: "",
        website: "",
        industry: "",
        address: "",
        city: "",
        state: "",
        postal_code: "",
        country: "",
        contact_person: "",
        partnership_type: "",
        status: "active",
        notes: "",
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
      }
    }
  };

  const updateFormData = (field: keyof PartnerInsert, value: string) => {
    setFormData({ ...formData, [field]: value });
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors({ ...errors, [field]: "" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Add Partner
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add New Partner</DialogTitle>
          <DialogDescription>
            Create a new partnership record. Fill in the partner's information below.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Partner Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => updateFormData("name", e.target.value)}
                placeholder="Partner Name"
                maxLength={100}
                required
              />
              {errors.name && (
                <p className="text-sm text-destructive">{errors.name}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="company_name">Company Name</Label>
              <Input
                id="company_name"
                value={formData.company_name}
                onChange={(e) => updateFormData("company_name", e.target.value)}
                placeholder="Company Name"
                maxLength={100}
              />
              {errors.company_name && (
                <p className="text-sm text-destructive">{errors.company_name}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => updateFormData("email", e.target.value)}
                placeholder="partner@example.com"
                maxLength={255}
              />
              {errors.email && (
                <p className="text-sm text-destructive">{errors.email}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={formData.phone}
                onChange={(e) => updateFormData("phone", e.target.value)}
                placeholder="+1 (555) 123-4567"
                maxLength={20}
              />
              {errors.phone && (
                <p className="text-sm text-destructive">{errors.phone}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="website">Website</Label>
              <Input
                id="website"
                value={formData.website}
                onChange={(e) => updateFormData("website", e.target.value)}
                placeholder="https://partner-website.com"
                maxLength={255}
              />
              {errors.website && (
                <p className="text-sm text-destructive">{errors.website}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="industry">Industry</Label>
              <Input
                id="industry"
                value={formData.industry}
                onChange={(e) => updateFormData("industry", e.target.value)}
                placeholder="Technology, Manufacturing, etc."
                maxLength={100}
              />
              {errors.industry && (
                <p className="text-sm text-destructive">{errors.industry}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="address">Address</Label>
            <Input
              id="address"
              value={formData.address}
              onChange={(e) => updateFormData("address", e.target.value)}
              placeholder="Street Address"
              maxLength={255}
            />
            {errors.address && (
              <p className="text-sm text-destructive">{errors.address}</p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                value={formData.city}
                onChange={(e) => updateFormData("city", e.target.value)}
                placeholder="City"
                maxLength={100}
              />
              {errors.city && (
                <p className="text-sm text-destructive">{errors.city}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="state">State</Label>
              <Input
                id="state"
                value={formData.state}
                onChange={(e) => updateFormData("state", e.target.value)}
                placeholder="State"
                maxLength={50}
              />
              {errors.state && (
                <p className="text-sm text-destructive">{errors.state}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="postal_code">Postal Code</Label>
              <Input
                id="postal_code"
                value={formData.postal_code}
                onChange={(e) => updateFormData("postal_code", e.target.value)}
                placeholder="ZIP Code"
                maxLength={20}
              />
              {errors.postal_code && (
                <p className="text-sm text-destructive">{errors.postal_code}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="country">Country</Label>
              <Input
                id="country"
                value={formData.country}
                onChange={(e) => updateFormData("country", e.target.value)}
                placeholder="Country"
                maxLength={100}
              />
              {errors.country && (
                <p className="text-sm text-destructive">{errors.country}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact_person">Contact Person</Label>
              <Input
                id="contact_person"
                value={formData.contact_person}
                onChange={(e) => updateFormData("contact_person", e.target.value)}
                placeholder="Primary Contact"
                maxLength={100}
              />
              {errors.contact_person && (
                <p className="text-sm text-destructive">{errors.contact_person}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="partnership_type">Partnership Type</Label>
              <Select value={formData.partnership_type} onValueChange={(value) => updateFormData("partnership_type", value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="technology">Technology</SelectItem>
                  <SelectItem value="vendor">Vendor</SelectItem>
                  <SelectItem value="distributor">Distributor</SelectItem>
                  <SelectItem value="strategic">Strategic</SelectItem>
                </SelectContent>
              </Select>
              {errors.partnership_type && (
                <p className="text-sm text-destructive">{errors.partnership_type}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select value={formData.status} onValueChange={(value) => updateFormData("status", value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                </SelectContent>
              </Select>
              {errors.status && (
                <p className="text-sm text-destructive">{errors.status}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => updateFormData("notes", e.target.value)}
              placeholder="Additional notes about the partnership..."
              maxLength={1000}
            />
            {errors.notes && (
              <p className="text-sm text-destructive">{errors.notes}</p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Add Partner</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}