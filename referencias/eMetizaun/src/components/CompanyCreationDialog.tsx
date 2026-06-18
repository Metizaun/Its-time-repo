import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CompanyInsert } from "@/hooks/useCompanies";

interface CompanyCreationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCompanyCreated: (company: CompanyInsert & { id?: string }) => void;
}

export function CompanyCreationDialog({ 
  open, 
  onOpenChange, 
  onCompanyCreated 
}: CompanyCreationDialogProps) {
  const [formData, setFormData] = useState({
    name: "",
    website: "",
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
    
    const companyData = {
      name: formData.name,
      website: formData.website ? normalizeWebsite(formData.website) : undefined,
    };
    
    onCompanyCreated(companyData);
    setFormData({ name: "", website: "" });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Add New Company</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="company_name">Company Name *</Label>
            <Input
              id="company_name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Enter company name"
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="company_website">Website</Label>
            <Input
              id="company_website"
              value={formData.website}
              onChange={(e) => setFormData({ ...formData, website: e.target.value })}
              placeholder="example.com or www.example.com"
            />
            <p className="text-xs text-muted-foreground">
              Enter domain like "example.com" or "www.example.com" - we'll format it automatically
            </p>
          </div>
          <div className="flex justify-end space-x-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Add Company</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}