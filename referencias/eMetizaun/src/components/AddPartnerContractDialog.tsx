import { useState } from "react";
import { Plus, Upload, X } from "lucide-react";
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
import { PartnerContractInsert, usePartners } from "@/hooks/usePartners";
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

interface AddPartnerContractDialogProps {
  partnerId: string;
  onContractAdded: () => void;
}

export function AddPartnerContractDialog({ partnerId, onContractAdded }: AddPartnerContractDialogProps) {
  const [open, setOpen] = useState(false);
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
  const { createPartnerContract, uploadContractFile } = usePartners();
  const { toast } = useToast();

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
    const fileInput = document.getElementById('contract-file') as HTMLInputElement;
    if (fileInput) {
      fileInput.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setLoading(true);

    try {
      // Clean empty strings to undefined, but preserve required fields
      const cleanedFormData: Partial<Omit<PartnerContractInsert, 'partner_id'>> = {};
      
      Object.entries(formData).forEach(([key, value]) => {
        if (key === 'title' || (value !== "" && value !== undefined)) {
          if (key === 'contract_value' && value === "") {
            // Skip empty contract_value
            return;
          }
          (cleanedFormData as any)[key] = value;
        }
      });

      // Validate the form data first
      const validatedFormData = contractSchema.parse(cleanedFormData);
      
      // Then combine with partner_id for the final contract data
      const validatedData: PartnerContractInsert = {
        partner_id: partnerId,
        title: validatedFormData.title,
        contract_number: validatedFormData.contract_number || undefined,
        contract_type: validatedFormData.contract_type || undefined,
        status: validatedFormData.status || "draft",
        start_date: validatedFormData.start_date || undefined,
        end_date: validatedFormData.end_date || undefined,
        renewal_date: validatedFormData.renewal_date || undefined,
        contract_value: validatedFormData.contract_value || undefined,
        currency: validatedFormData.currency || "USD",
        payment_terms: validatedFormData.payment_terms || undefined,
        description: validatedFormData.description || undefined,
        notes: validatedFormData.notes || undefined,
      };

      // Create the contract first
      const newContract = await createPartnerContract(validatedData);

      // Upload file if selected
      if (selectedFile) {
        try {
          await uploadContractFile(newContract.id, selectedFile);
          toast({
            title: "Contract created",
            description: `Contract "${newContract.title}" has been created with the document.`,
          });
        } catch (uploadError) {
          toast({
            title: "Contract created with warning",
            description: `Contract was created but file upload failed. You can try uploading the file again.`,
            variant: "destructive",
          });
        }
      } else {
        toast({
          title: "Contract created",
          description: `Contract "${newContract.title}" has been created.`,
        });
      }

      onContractAdded();
      setOpen(false);
      resetForm();
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
          description: "Failed to create contract. Please try again.",
          variant: "destructive",
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
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
    setSelectedFile(null);
    setErrors({});
  };

  const updateFormData = (field: keyof Omit<PartnerContractInsert, 'partner_id'>, value: string | number | undefined) => {
    setFormData({ ...formData, [field]: value });
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors({ ...errors, [field]: "" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="mr-2 h-4 w-4" />
          Add Contract
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add New Contract</DialogTitle>
          <DialogDescription>
            Create a new contract for this partner. You can upload the contract document as well.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="title">Contract Title *</Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) => updateFormData("title", e.target.value)}
                placeholder="Service Agreement, License, etc."
                maxLength={200}
                required
              />
              {errors.title && (
                <p className="text-sm text-destructive">{errors.title}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="contract_number">Contract Number</Label>
              <Input
                id="contract_number"
                value={formData.contract_number}
                onChange={(e) => updateFormData("contract_number", e.target.value)}
                placeholder="CON-2024-001"
                maxLength={100}
              />
              {errors.contract_number && (
                <p className="text-sm text-destructive">{errors.contract_number}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="contract_type">Contract Type</Label>
              <Select value={formData.contract_type} onValueChange={(value) => updateFormData("contract_type", value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="service_agreement">Service Agreement</SelectItem>
                  <SelectItem value="licensing">Licensing</SelectItem>
                  <SelectItem value="distribution">Distribution</SelectItem>
                  <SelectItem value="nda">Non-Disclosure Agreement</SelectItem>
                  <SelectItem value="partnership">Partnership Agreement</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
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
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="start_date">Start Date</Label>
              <Input
                id="start_date"
                type="date"
                value={formData.start_date}
                onChange={(e) => updateFormData("start_date", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end_date">End Date</Label>
              <Input
                id="end_date"
                type="date"
                value={formData.end_date}
                onChange={(e) => updateFormData("end_date", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="renewal_date">Renewal Date</Label>
              <Input
                id="renewal_date"
                type="date"
                value={formData.renewal_date}
                onChange={(e) => updateFormData("renewal_date", e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="contract_value">Contract Value</Label>
              <Input
                id="contract_value"
                type="number"
                min="0"
                step="0.01"
                value={formData.contract_value || ""}
                onChange={(e) => updateFormData("contract_value", e.target.value ? parseFloat(e.target.value) : undefined)}
                placeholder="0.00"
              />
              {errors.contract_value && (
                <p className="text-sm text-destructive">{errors.contract_value}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="currency">Currency</Label>
              <Select value={formData.currency} onValueChange={(value) => updateFormData("currency", value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select currency" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                  <SelectItem value="GBP">GBP</SelectItem>
                  <SelectItem value="JPY">JPY</SelectItem>
                  <SelectItem value="CAD">CAD</SelectItem>
                  <SelectItem value="AUD">AUD</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="payment_terms">Payment Terms</Label>
            <Input
              id="payment_terms"
              value={formData.payment_terms}
              onChange={(e) => updateFormData("payment_terms", e.target.value)}
              placeholder="Net 30, Monthly, Annual, etc."
              maxLength={500}
            />
            {errors.payment_terms && (
              <p className="text-sm text-destructive">{errors.payment_terms}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => updateFormData("description", e.target.value)}
              placeholder="Brief description of the contract..."
              maxLength={1000}
              rows={3}
            />
            {errors.description && (
              <p className="text-sm text-destructive">{errors.description}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => updateFormData("notes", e.target.value)}
              placeholder="Additional notes..."
              maxLength={1000}
              rows={2}
            />
            {errors.notes && (
              <p className="text-sm text-destructive">{errors.notes}</p>
            )}
          </div>

          {/* File Upload Section */}
          <div className="space-y-2">
            <Label>Contract Document</Label>
            <div className="border-2 border-dashed border-gray-200 rounded-lg p-4">
              {selectedFile ? (
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <div className="h-8 w-8 bg-primary/10 rounded flex items-center justify-center">
                      <Upload className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{selectedFile.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={removeSelectedFile}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="text-center">
                  <Upload className="mx-auto h-8 w-8 text-gray-400" />
                  <div className="mt-2">
                    <label htmlFor="contract-file" className="cursor-pointer">
                      <span className="text-sm font-medium text-primary hover:text-primary/80">
                        Upload contract document
                      </span>
                      <input
                        id="contract-file"
                        type="file"
                        className="hidden"
                        accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg"
                        onChange={handleFileSelect}
                      />
                    </label>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    PDF, DOC, DOCX, TXT, images up to 20MB
                  </p>
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Creating..." : "Create Contract"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}