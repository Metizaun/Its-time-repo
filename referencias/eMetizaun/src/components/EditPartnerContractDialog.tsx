import { useState, useEffect } from "react";
import { Edit, Upload, X } from "lucide-react";
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
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PartnerContract, PartnerContractInsert, usePartners } from "@/hooks/usePartners";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";

const contractSchema = z.object({
  title: z.string()
    .min(1, { message: "Contract title is required" })
    .max(200, { message: "Title must be less than 200 characters" }),
  contract_number: z.string()
    .max(100, { message: "Contract number must be less than 100 characters" })
    .optional(),
  contract_type: z.string().optional(),
  status: z.string().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  renewal_date: z.string().optional(),
  contract_value: z.number()
    .min(0, { message: "Contract value must be positive" })
    .optional(),
  currency: z.string()
    .max(3, { message: "Currency code must be 3 characters" })
    .optional(),
  payment_terms: z.string()
    .max(500, { message: "Payment terms must be less than 500 characters" })
    .optional(),
  description: z.string()
    .max(1000, { message: "Description must be less than 1000 characters" })
    .optional(),
  notes: z.string()
    .max(1000, { message: "Notes must be less than 1000 characters" })
    .optional(),
});

interface EditPartnerContractDialogProps {
  contract: PartnerContract | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onContractUpdated: () => void;
}

export function EditPartnerContractDialog({ 
  contract, 
  open, 
  onOpenChange, 
  onContractUpdated 
}: EditPartnerContractDialogProps) {
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [formData, setFormData] = useState<Omit<PartnerContractInsert, 'partner_id'>>({
    title: "",
    contract_number: "",
    contract_type: "",
    status: "draft",
    start_date: "",
    end_date: "",
    renewal_date: "",
    contract_value: undefined,
    currency: "USD",
    payment_terms: "",
    description: "",
    notes: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { updatePartnerContract, uploadContractFile } = usePartners();
  const { toast } = useToast();

  // Initialize form data when contract changes
  useEffect(() => {
    if (contract) {
      setFormData({
        title: contract.title || "",
        contract_number: contract.contract_number || "",
        contract_type: contract.contract_type || "",
        status: contract.status || "draft",
        start_date: contract.start_date || "",
        end_date: contract.end_date || "",
        renewal_date: contract.renewal_date || "",
        contract_value: contract.contract_value || undefined,
        currency: contract.currency || "USD",
        payment_terms: contract.payment_terms || "",
        description: contract.description || "",
        notes: contract.notes || "",
      });
      setErrors({});
      setSelectedFile(null);
    }
  }, [contract]);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Check file size (20MB limit)
      if (file.size > 20 * 1024 * 1024) {
        toast({
          title: "File too large",
          description: "Please select a file smaller than 20MB.",
          variant: "destructive",
        });
        return;
      }
      setSelectedFile(file);
    }
  };

  const removeSelectedFile = () => {
    setSelectedFile(null);
    // Reset the file input
    const fileInput = document.getElementById('edit-contract-file') as HTMLInputElement;
    if (fileInput) {
      fileInput.value = '';
    }
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    try {
      // Prepare data for validation
      const cleanedFormData: Partial<Omit<PartnerContractInsert, 'partner_id'>> = {};
      
      Object.entries(formData).forEach(([key, value]) => {
        if (value !== "" && value !== undefined && value !== null) {
          if (key === 'contract_value' && value === "") {
            // Skip empty contract_value
            return;
          }
          (cleanedFormData as any)[key] = value;
        }
      });

      contractSchema.parse(cleanedFormData);
    } catch (error) {
      if (error instanceof z.ZodError) {
        error.errors.forEach((err) => {
          if (err.path[0]) {
            newErrors[err.path[0].toString()] = err.message;
          }
        });
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!contract) return;

    if (!validateForm()) {
      return;
    }

    setLoading(true);

    try {
      // Prepare the update data
      const cleanedFormData: Partial<Omit<PartnerContractInsert, 'partner_id'>> = {};
      
      Object.entries(formData).forEach(([key, value]) => {
        if (value !== "" && value !== undefined && value !== null) {
          if (key === 'contract_value' && value === "") {
            // Skip empty contract_value
            return;
          }
          (cleanedFormData as any)[key] = value;
        }
      });

      const validatedFormData = contractSchema.parse(cleanedFormData);

      // Update the contract
      const updatedContract = await updatePartnerContract(contract.id, validatedFormData);

      // Handle file upload if a new file was selected
      if (selectedFile) {
        try {
          await uploadContractFile(updatedContract.id, selectedFile);
          toast({
            title: "Contract updated",
            description: `Contract "${updatedContract.title}" has been updated with the new document.`,
          });
        } catch (fileError) {
          console.error('File upload failed:', fileError);
          toast({
            title: "Contract updated with warning",
            description: `Contract was updated but file upload failed. You can try uploading the file again.`,
            variant: "destructive",
          });
        }
      } else {
        toast({
          title: "Contract updated",
          description: `Contract "${updatedContract.title}" has been updated.`,
        });
      }

      onContractUpdated();
      onOpenChange(false);
      
    } catch (error) {
      console.error('Error updating contract:', error);
      toast({
        title: "Error",
        description: "Failed to update contract. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      onOpenChange(false);
    }
  };

  const updateFormData = (field: keyof Omit<PartnerContractInsert, 'partner_id'>, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: "" }));
    }
  };

  if (!contract) return null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Contract</DialogTitle>
          <DialogDescription>
            Update the contract details. You can also upload a new contract document.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label htmlFor="edit-title">Contract Title *</Label>
              <Input
                id="edit-title"
                value={formData.title}
                onChange={(e) => updateFormData("title", e.target.value)}
                placeholder="Enter contract title"
                className={errors.title ? "border-destructive" : ""}
              />
              {errors.title && (
                <p className="text-sm text-destructive">{errors.title}</p>
              )}
            </div>

            <div>
              <Label htmlFor="edit-contract_number">Contract Number</Label>
              <Input
                id="edit-contract_number"
                value={formData.contract_number}
                onChange={(e) => updateFormData("contract_number", e.target.value)}
                placeholder="Enter contract number"
              />
              {errors.contract_number && (
                <p className="text-sm text-destructive">{errors.contract_number}</p>
              )}
            </div>

            <div>
              <Label htmlFor="edit-contract_type">Contract Type</Label>
              <Select value={formData.contract_type} onValueChange={(value) => updateFormData("contract_type", value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select contract type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="service_agreement">Service Agreement</SelectItem>
                  <SelectItem value="partnership_agreement">Partnership Agreement</SelectItem>
                  <SelectItem value="licensing_agreement">Licensing Agreement</SelectItem>
                  <SelectItem value="nda">Non-Disclosure Agreement</SelectItem>
                  <SelectItem value="consulting_agreement">Consulting Agreement</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="edit-status">Status</Label>
              <Select value={formData.status} onValueChange={(value) => updateFormData("status", value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                  <SelectItem value="terminated">Terminated</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="edit-start_date">Start Date</Label>
              <Input
                id="edit-start_date"
                type="date"
                value={formData.start_date}
                onChange={(e) => updateFormData("start_date", e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="edit-end_date">End Date</Label>
              <Input
                id="edit-end_date"
                type="date"
                value={formData.end_date}
                onChange={(e) => updateFormData("end_date", e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="edit-renewal_date">Renewal Date</Label>
              <Input
                id="edit-renewal_date"
                type="date"
                value={formData.renewal_date}
                onChange={(e) => updateFormData("renewal_date", e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="edit-contract_value">Contract Value</Label>
              <Input
                id="edit-contract_value"
                type="number"
                min="0"
                step="0.01"
                value={formData.contract_value || ""}
                onChange={(e) => updateFormData("contract_value", e.target.value ? parseFloat(e.target.value) : undefined)}
                placeholder="Enter contract value"
              />
              {errors.contract_value && (
                <p className="text-sm text-destructive">{errors.contract_value}</p>
              )}
            </div>

            <div>
              <Label htmlFor="edit-currency">Currency</Label>
              <Select value={formData.currency} onValueChange={(value) => updateFormData("currency", value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select currency" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                  <SelectItem value="GBP">GBP</SelectItem>
                  <SelectItem value="CAD">CAD</SelectItem>
                  <SelectItem value="AUD">AUD</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-2">
              <Label htmlFor="edit-payment_terms">Payment Terms</Label>
              <Textarea
                id="edit-payment_terms"
                value={formData.payment_terms}
                onChange={(e) => updateFormData("payment_terms", e.target.value)}
                placeholder="Enter payment terms"
                rows={2}
              />
              {errors.payment_terms && (
                <p className="text-sm text-destructive">{errors.payment_terms}</p>
              )}
            </div>

            <div className="col-span-2">
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                value={formData.description}
                onChange={(e) => updateFormData("description", e.target.value)}
                placeholder="Enter contract description"
                rows={3}
              />
              {errors.description && (
                <p className="text-sm text-destructive">{errors.description}</p>
              )}
            </div>

            <div className="col-span-2">
              <Label htmlFor="edit-notes">Notes</Label>
              <Textarea
                id="edit-notes"
                value={formData.notes}
                onChange={(e) => updateFormData("notes", e.target.value)}
                placeholder="Enter any additional notes"
                rows={2}
              />
              {errors.notes && (
                <p className="text-sm text-destructive">{errors.notes}</p>
              )}
            </div>

            <div className="col-span-2">
              <Label htmlFor="edit-contract-file">Upload New Contract Document (Optional)</Label>
              <div className="space-y-2">
                <Input
                  id="edit-contract-file"
                  type="file"
                  onChange={handleFileSelect}
                  accept=".pdf,.doc,.docx,.txt"
                  className="cursor-pointer"
                />
                {selectedFile && (
                  <div className="flex items-center justify-between bg-muted p-2 rounded">
                    <span className="text-sm">{selectedFile.name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={removeSelectedFile}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                )}
                {contract.file_url && !selectedFile && (
                  <p className="text-sm text-muted-foreground">
                    Current document will be kept unless you upload a new one.
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Accepted formats: PDF, DOC, DOCX, TXT (max 20MB)
                </p>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Updating..." : "Update Contract"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}