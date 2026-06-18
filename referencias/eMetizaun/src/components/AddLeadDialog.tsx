import { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useLeads } from '@/hooks/useLeads';
import { useAuth } from '@/hooks/useAuth';
import { useOrganizationContext } from '@/hooks/useOrganizationContext';
import { useCompanies, Company, CompanyInsert } from '@/hooks/useCompanies';
import { CompanyCreationDialog } from '@/components/CompanyCreationDialog';
import { z } from 'zod';
import { useToast } from '@/hooks/use-toast';

const leadSchema = z.object({
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

interface AddLeadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLeadCreated?: (leadId: string) => void;
}

export function AddLeadDialog({ open, onOpenChange, onLeadCreated }: AddLeadDialogProps) {
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyDialogOpen, setCompanyDialogOpen] = useState(false);
  const { createLead } = useLeads();
  const { user } = useAuth();
  const { currentOrganization } = useOrganizationContext();
  const { fetchCompanies, createCompany } = useCompanies();
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    company: '',
    company_id: '',
    title: '',
    industry: '',
    location: '',
    source: '',
    status: 'New',
    score: 0,
    notes: '',
  });

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
  }, [open, companies.length, fetchCompanies, toast]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !currentOrganization) return;

    // Clear previous errors
    setErrors({});

    // Validate form data
    try {
      const validatedData = leadSchema.parse({
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

      // If company_id is selected, get the company name, otherwise use the entered company text
      const selectedCompany = companies.find(c => c.id === formData.company_id);

      const leadData = {
        user_id: user.id,
        organization_id: currentOrganization.id,
        first_name: validatedData.first_name,
        last_name: validatedData.last_name,
        email: validatedData.email,
        phone: validatedData.phone || '',
        company: selectedCompany ? selectedCompany.name : (validatedData.company || ''),
        title: validatedData.title || '',
        industry: validatedData.industry || '',
        location: validatedData.location || '',
        source: validatedData.source || '',
        status: validatedData.status,
        score: validatedData.score,
        notes: validatedData.notes || '',
      };

      const newLead = await createLead(leadData);
      
      // Reset form
      setFormData({
        first_name: '',
        last_name: '',
        email: '',
        phone: '',
        company: '',
        company_id: '',
        title: '',
        industry: '',
        location: '',
        source: '',
        status: 'New',
        score: 0,
        notes: '',
      });

      onOpenChange(false);
      onLeadCreated?.(newLead.id);
      
      toast({
        title: "Success",
        description: "Lead created successfully",
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
          description: "Failed to create lead",
          variant: "destructive",
        });
      }
    } finally {
      setLoading(false);
    }
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
      <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add New Lead</DialogTitle>
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
              <Select
                value={formData.company_id}
                onValueChange={(value) => setFormData(prev => ({ ...prev, company_id: value, company: "" }))}
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

          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Creating...' : 'Create Lead'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
    
    <CompanyCreationDialog
      open={companyDialogOpen}
      onOpenChange={setCompanyDialogOpen}
      onCompanyCreated={handleCompanyCreated}
    />
    </>
  );
}