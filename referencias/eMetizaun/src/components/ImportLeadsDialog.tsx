import { useState, useRef } from "react";
import { Upload, FileText, AlertTriangle, CheckCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Lead } from "@/hooks/useLeads";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useOrganizationContext } from "@/hooks/useOrganizationContext";

interface ImportLeadsDialogProps {
  onImportLeads: (leads: Omit<Lead, 'id' | 'created_at' | 'updated_at'>[]) => Promise<void>;
}

interface ParsedLead extends Omit<Lead, 'id' | 'created_at' | 'updated_at'> {
  rowNumber: number;
  errors: string[];
}

const CSV_HEADERS = [
  'first_name (or first/name)', 'last_name (or last/name)', 'email', 'company',
  'phone (or telephone)', 'website (or url)', 'title', 'industry', 'location',
  'source', 'status', 'score', 'notes'
];

export function ImportLeadsDialog({ onImportLeads }: ImportLeadsDialogProps) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parsedLeads, setParsedLeads] = useState<ParsedLead[]>([]);
  const [importing, setImporting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { currentOrganization } = useOrganizationContext();

  const parseCSVLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const next = line[i + 1];
      if (char === '"') {
        if (inQuotes && next === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  const parseCSV = (csvText: string): ParsedLead[] => {
    const lines = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const nonEmpty = lines.filter(line => line.trim());
    if (nonEmpty.length === 0) return [];

    const headers = parseCSVLine(nonEmpty[0]).map(h => h.replace(/^\uFEFF/, '').toLowerCase().replace(/['"]/g, '').trim());
    const leads: ParsedLead[] = [];

    for (let i = 1; i < nonEmpty.length; i++) {
      const values = parseCSVLine(nonEmpty[i]);
      const lead: ParsedLead = {
        user_id: '',
        organization_id: '',
        first_name: '',
        last_name: '',
        email: '',
        status: 'New',
        score: 0,
        rowNumber: i + 1,
        errors: []
      };

      headers.forEach((header, index) => {
        const value = values[index]?.trim() || '';
        
        switch (header) {
          case 'first_name':
          case 'firstname':
          case 'first name':
            lead.first_name = value;
            break;
          case 'last_name':
          case 'lastname':
          case 'last name':
            lead.last_name = value;
            break;
          case 'email':
            if (value) {
              const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
              if (emailRegex.test(value)) {
                lead.email = value;
              } else {
                lead.errors.push('Invalid email format');
              }
            } else {
              lead.email = value;
            }
            break;
          case 'company':
            lead.company = value || undefined;
            break;
          case 'phone':
          case 'telephone':
          case 'phone_number':
            lead.phone = value || undefined;
            break;
          case 'website':
          case 'url':
            lead.website = value || undefined;
            break;
          case 'title':
            lead.title = value || undefined;
            break;
          case 'industry':
            lead.industry = value || undefined;
            break;
          case 'location':
            lead.location = value || undefined;
            break;
          case 'source':
            lead.source = value || undefined;
            break;
          case 'status':
            lead.status = value || 'New';
            break;
          case 'score':
            if (value) {
              const score = parseInt(value);
              if (!isNaN(score) && score >= 0 && score <= 100) {
                lead.score = score;
              } else {
                lead.errors.push('Score must be between 0 and 100');
              }
            }
            break;
          case 'notes':
            lead.notes = value || undefined;
            break;
        }
      });

      // Validate required fields
      if (!lead.first_name) {
        lead.errors.push('First name is required');
      }
      if (!lead.last_name) {
        lead.errors.push('Last name is required');
      }
      if (!lead.email) {
        lead.errors.push('Email is required');
      }

      leads.push(lead);
    }

    return leads;
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;

    if (!selectedFile.name.toLowerCase().endsWith('.csv')) {
      toast({
        title: "Invalid file type",
        description: "Please select a CSV file.",
        variant: "destructive",
      });
      return;
    }

    setFile(selectedFile);
    
    const reader = new FileReader();
    reader.onload = (e) => {
      const csvText = e.target?.result as string;
      const parsed = parseCSV(csvText);
      setParsedLeads(parsed);
      setShowPreview(true);
    };
    reader.readAsText(selectedFile);
  };

  const handleImport = async () => {
    const validLeads = parsedLeads
      .filter(lead => lead.first_name && lead.last_name && lead.email && lead.errors.length === 0)
      .map(({ rowNumber, errors, ...rest }) => rest);

    if (validLeads.length === 0) {
      toast({
        title: "No valid leads",
        description: "Please fix the errors before importing.",
        variant: "destructive",
      });
      return;
    }

    if (!currentOrganization) {
      toast({
        title: "No organization selected",
        description: "Please wait for your organization to load or select one before importing.",
        variant: "destructive",
      });
      return;
    }

    try {
      setImporting(true);
      await onImportLeads(validLeads);
      
      // Reset state
      setFile(null);
      setParsedLeads([]);
      setShowPreview(false);
      setOpen(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      toast({
        title: "Import error",
        description: "Failed to import leads. Please try again.",
        variant: "destructive",
      });
    } finally {
      setImporting(false);
    }
  };

  const validLeads = parsedLeads.filter(c => c.first_name && c.last_name && c.email && c.errors.length === 0);
  const invalidLeads = parsedLeads.filter(c => !c.first_name || !c.last_name || !c.email || c.errors.length > 0);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Upload className="h-4 w-4" />
          Import CSV
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Leads from CSV</DialogTitle>
          <DialogDescription>
            Upload a CSV file to import multiple leads at once.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {!showPreview ? (
            <div className="space-y-4">
              <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center">
                <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <div className="space-y-2">
                  <h3 className="text-lg font-medium">Choose CSV File</h3>
                  <p className="text-sm text-muted-foreground">
                    Select a CSV file with lead data to import
                  </p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  onChange={handleFileSelect}
                  className="mt-4"
                />
              </div>

              <Card>
                <CardContent className="p-4">
                  <h4 className="font-medium mb-2">Expected CSV Format:</h4>
                  <p className="text-sm text-muted-foreground mb-2">
                    Your CSV should include these columns (first_name, last_name, and email are required):
                  </p>
                  <div className="text-xs text-muted-foreground font-mono bg-muted p-2 rounded">
                    {CSV_HEADERS.join(', ')}
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium">Import Preview</h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowPreview(false);
                    setFile(null);
                    setParsedLeads([]);
                    if (fileInputRef.current) {
                      fileInputRef.current.value = '';
                    }
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className="text-2xl font-bold text-green-600">{validLeads.length}</div>
                    <div className="text-sm text-muted-foreground">Valid Leads</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className="text-2xl font-bold text-red-600">{invalidLeads.length}</div>
                    <div className="text-sm text-muted-foreground">Invalid Leads</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className="text-2xl font-bold">{parsedLeads.length}</div>
                    <div className="text-sm text-muted-foreground">Total Rows</div>
                  </CardContent>
                </Card>
              </div>

              {parsedLeads.length > 0 && (
                <div className="max-h-60 overflow-y-auto border rounded">
                  <div className="space-y-2 p-4">
                    {parsedLeads.slice(0, 10).map((lead, index) => (
                      <div key={index} className="flex items-center justify-between p-2 border rounded">
                        <div className="flex items-center space-x-2">
                          {lead.errors.length === 0 ? (
                            <CheckCircle className="h-4 w-4 text-green-500" />
                          ) : (
                            <AlertTriangle className="h-4 w-4 text-red-500" />
                          )}
                          <span className="font-medium">
                            {lead.first_name} {lead.last_name}
                          </span>
                          {lead.company && (
                            <Badge variant="secondary">{lead.company}</Badge>
                          )}
                        </div>
                        {lead.errors.length > 0 && (
                          <div className="text-xs text-red-600">
                            {lead.errors.join(', ')}
                          </div>
                        )}
                      </div>
                    ))}
                    {parsedLeads.length > 10 && (
                      <div className="text-sm text-muted-foreground text-center py-2">
                        ... and {parsedLeads.length - 10} more rows
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="flex justify-end space-x-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowPreview(false);
                    setFile(null);
                    setParsedLeads([]);
                    if (fileInputRef.current) {
                      fileInputRef.current.value = '';
                    }
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleImport}
                  disabled={importing || validLeads.length === 0}
                >
                  {importing ? 'Importing...' : `Import ${validLeads.length} Leads`}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}