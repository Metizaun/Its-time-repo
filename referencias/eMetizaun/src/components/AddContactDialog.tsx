import { useState, useEffect } from "react";
import { Plus, X, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MobileDialog } from "@/components/ui/mobile-dialog";
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
import { Separator } from "@/components/ui/separator";
import { ContactInsert } from "@/hooks/useContacts";
import { useCompanies, Company, CompanyInsert } from "@/hooks/useCompanies";
import { CompanyCreationDialog } from "@/components/CompanyCreationDialog";
import { toast } from "@/hooks/use-toast";
import { z } from "zod";

const contactSchema = z.object({
  first_name: z.string().trim().min(1, "First name is required").max(100, "First name must be less than 100 characters"),
  last_name: z.string().trim().min(1, "Last name is required").max(100, "Last name must be less than 100 characters"),
  email: z.string().trim().email("Invalid email address").max(255, "Email must be less than 255 characters").optional().or(z.literal("")),
  phone: z.string().trim().max(50, "Phone must be less than 50 characters").optional(),
  company: z.string().trim().max(200, "Company name must be less than 200 characters").optional(),
  position: z.string().trim().max(100, "Position must be less than 100 characters").optional(),
  notes: z.string().trim().max(2000, "Notes must be less than 2000 characters").optional(),
  personal_notes: z.string().trim().max(2000, "Personal notes must be less than 2000 characters").optional(),
});

interface AddContactDialogProps {
  onAddContact: (contact: ContactInsert) => void;
}

export function AddContactDialog({ onAddContact }: AddContactDialogProps) {
  const [open, setOpen] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyDialogOpen, setCompanyDialogOpen] = useState(false);
  const { fetchCompanies, createCompany } = useCompanies();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formData, setFormData] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    company: "",
    company_id: "",
    position: "",
    notes: "",
    birthday: "",
    anniversary: "",
    personal_notes: "",
  });
  const [importantDates, setImportantDates] = useState<{ label: string; date: string }[]>([]);

  useEffect(() => {
    const loadCompanies = async () => {
      try {
        const companiesData = await fetchCompanies();
        setCompanies(companiesData);
      } catch (error) {
        toast({
          title: "Error",
          description: "Failed to load companies",
          variant: "destructive",
        });
      }
    };

    // Only fetch companies if dialog is open and we don't have any companies loaded yet
    if (open && companies.length === 0) {
      loadCompanies();
    }
  }, [open, companies.length, fetchCompanies]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    try {
      const validatedData = contactSchema.parse({
        first_name: formData.first_name,
        last_name: formData.last_name,
        email: formData.email,
        phone: formData.phone,
        company: formData.company,
        position: formData.position,
        notes: formData.notes,
        personal_notes: formData.personal_notes,
      });

      // If company_id is selected, get the company name, otherwise use the entered company text
      const selectedCompany = companies.find(c => c.id === formData.company_id);

      // Convert empty strings to null for nullable date fields
      const contactData: ContactInsert = {
        first_name: validatedData.first_name,
        last_name: validatedData.last_name,
        email: validatedData.email || undefined,
        phone: validatedData.phone || undefined,
        company: selectedCompany ? selectedCompany.name : validatedData.company || undefined,
        company_id: formData.company_id || undefined,
        position: validatedData.position || undefined,
        notes: validatedData.notes || undefined,
        personal_notes: validatedData.personal_notes || undefined,
        birthday: formData.birthday || undefined,
        anniversary: formData.anniversary || undefined,
        important_dates: importantDates.length > 0 ? importantDates : undefined,
      };
      onAddContact(contactData);
      setFormData({
        first_name: "",
        last_name: "",
        email: "",
        phone: "",
        company: "",
        company_id: "",
        position: "",
        notes: "",
        birthday: "",
        anniversary: "",
        personal_notes: "",
      });
      setImportantDates([]);
      setErrors({});
      setOpen(false);
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

  const addImportantDate = () => {
    setImportantDates([...importantDates, { label: "", date: "" }]);
  };

  const updateImportantDate = (index: number, field: 'label' | 'date', value: string) => {
    const updated = [...importantDates];
    updated[index][field] = value;
    setImportantDates(updated);
  };

  const removeImportantDate = (index: number) => {
    setImportantDates(importantDates.filter((_, i) => i !== index));
  };

  const handleCompanyCreated = async (companyData: CompanyInsert) => {
    try {
      const newCompany = await createCompany(companyData);
      setCompanies([newCompany, ...companies]);
      setFormData({ ...formData, company_id: newCompany.id, company: "" });
      toast({
        title: "Success",
        description: "Company created and selected",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to create company",
        variant: "destructive",
      });
    }
  };

  return (
    <>
      <MobileDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Add Contact
        </Button>
      }
      title="Add New Contact"
      description="Add a new contact to your CRM. Fill in the details below."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
          {/* Professional Information */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="first_name">First Name</Label>
                <Input
                  id="first_name"
                  value={formData.first_name}
                  onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                  required
                  maxLength={100}
                />
                {errors.first_name && (
                  <p className="text-sm text-destructive">{errors.first_name}</p>
                )}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="last_name">Last Name</Label>
                <Input
                  id="last_name"
                  value={formData.last_name}
                  onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                  required
                  maxLength={100}
                />
                {errors.last_name && (
                  <p className="text-sm text-destructive">{errors.last_name}</p>
                )}
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                maxLength={255}
              />
              {errors.email && (
                <p className="text-sm text-destructive">{errors.email}</p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="company">Company</Label>
              <Select
                value={formData.company_id}
                onValueChange={(value) => setFormData({ ...formData, company_id: value, company: "" })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a company (optional)" />
                </SelectTrigger>
                <SelectContent>
                  {companies.map((company) => (
                    <SelectItem key={company.id} value={company.id}>
                      {company.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex gap-2 mt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setCompanyDialogOpen(true)}
                  className="flex-1"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Manually Add Company
                </Button>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="position">Position</Label>
              <Input
                id="position"
                value={formData.position}
                onChange={(e) => setFormData({ ...formData, position: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="notes">Business Notes</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={3}
              />
            </div>
          </div>

          <Separator />

          {/* Personal Information */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium">Personal Information</h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="birthday">Birthday</Label>
                <Input
                  id="birthday"
                  type="date"
                  value={formData.birthday}
                  onChange={(e) => setFormData({ ...formData, birthday: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="anniversary">Anniversary</Label>
                <Input
                  id="anniversary"
                  type="date"
                  value={formData.anniversary}
                  onChange={(e) => setFormData({ ...formData, anniversary: e.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="personal_notes">Personal Notes</Label>
              <Textarea
                id="personal_notes"
                value={formData.personal_notes}
                onChange={(e) => setFormData({ ...formData, personal_notes: e.target.value })}
                rows={2}
                placeholder="Personal interests, hobbies, preferences..."
              />
            </div>

            {/* Important Dates */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Important Dates</Label>
                <Button type="button" onClick={addImportantDate} size="sm" variant="outline">
                  <Plus className="h-3 w-3 mr-1" />
                  Add Date
                </Button>
              </div>
              {importantDates.map((date, index) => (
                <div key={index} className="flex gap-2 items-center">
                  <Input
                    placeholder="Label (e.g., First Meeting)"
                    value={date.label}
                    onChange={(e) => updateImportantDate(index, 'label', e.target.value)}
                    className="flex-1"
                  />
                  <Input
                    type="date"
                    value={date.date}
                    onChange={(e) => updateImportantDate(index, 'date', e.target.value)}
                    className="w-40"
                  />
                  <Button
                    type="button"
                    onClick={() => removeImportantDate(index)}
                    size="sm"
                    variant="outline"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end space-x-2 pt-4">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Add Contact</Button>
          </div>
        </form>
      </MobileDialog>
      
      <CompanyCreationDialog
        open={companyDialogOpen}
        onOpenChange={setCompanyDialogOpen}
        onCompanyCreated={handleCompanyCreated}
      />
    </>
  );
}