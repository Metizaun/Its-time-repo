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
import { ContactInsert } from "@/hooks/useContacts";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useOrganizationContext } from "@/hooks/useOrganizationContext";

interface ImportContactsDialogProps {
  onImportContacts: (contacts: ContactInsert[]) => Promise<void>;
}

interface ParsedContact extends ContactInsert {
  rowNumber: number;
  errors: string[];
}

const CSV_HEADERS = [
  'first_name (or first/name)', 'last_name (or last/name)', 'email',
  'phone (or telephone)', 'company (or organization)', 'position (or title)', 'notes'
];

export function ImportContactsDialog({ onImportContacts }: ImportContactsDialogProps) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parsedContacts, setParsedContacts] = useState<ParsedContact[]>([]);
  const [importing, setImporting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { currentOrganization } = useOrganizationContext();

  // Helper to parse a CSV line with quotes
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

  const parseCSV = (csvText: string): ParsedContact[] => {
    const lines = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const nonEmpty = lines.filter(l => l.trim());
    if (nonEmpty.length === 0) return [];

    const headers = parseCSVLine(nonEmpty[0]).map(h => h.replace(/^\uFEFF/, '').toLowerCase().replace(/['"]/g, '').trim());
    const contacts: ParsedContact[] = [];

    for (let i = 1; i < nonEmpty.length; i++) {
      const values = parseCSVLine(nonEmpty[i]);
      const contact: ParsedContact = {
        first_name: '',
        last_name: '',
        rowNumber: i + 1,
        errors: []
      };

      headers.forEach((header, index) => {
        const value = values[index]?.trim() || '';
        
        switch (header) {
          case 'first_name':
          case 'firstname':
          case 'first name':
          case 'given_name':
          case 'given name':
            contact.first_name = value;
            break;
          case 'last_name':
          case 'lastname':
          case 'last name':
          case 'surname':
            contact.last_name = value;
            break;
          case 'email':
            if (value) {
              const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
              if (emailRegex.test(value)) {
                contact.email = value;
              } else {
                contact.errors.push('Invalid email format');
              }
            }
            break;
          case 'phone':
          case 'telephone':
          case 'phone_number':
          case 'phone number':
            contact.phone = value || undefined;
            break;
          case 'company':
          case 'organization':
            contact.company = value || undefined;
            break;
          case 'position':
          case 'title':
            contact.position = value || undefined;
            break;
          case 'notes':
            contact.notes = value || undefined;
            break;
        }
      });

      // Validate required fields
      if (!contact.first_name) {
        contact.errors.push('First name is required');
      }
      if (!contact.last_name) {
        contact.errors.push('Last name is required');
      }

      contacts.push(contact);
    }

    return contacts;
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
      setParsedContacts(parsed);
      setShowPreview(true);
    };
    reader.readAsText(selectedFile);
  };

  const handleImport = async () => {
    const validContacts = parsedContacts
      .filter(contact => contact.first_name && contact.last_name && contact.errors.length === 0)
      .map(({ rowNumber, errors, ...rest }) => rest);

    if (validContacts.length === 0) {
      toast({
        title: "No valid contacts",
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
      await onImportContacts(validContacts as ContactInsert[]);
      
      // Reset state
      setFile(null);
      setParsedContacts([]);
      setShowPreview(false);
      setOpen(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      toast({
        title: "Import error",
        description: "Failed to import contacts. Please try again.",
        variant: "destructive",
      });
    } finally {
      setImporting(false);
    }
  };

  const validContacts = parsedContacts.filter(c => c.first_name && c.last_name && c.errors.length === 0);
  const invalidContacts = parsedContacts.filter(c => !c.first_name || !c.last_name || c.errors.length > 0);

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
          <DialogTitle>Import Contacts from CSV</DialogTitle>
          <DialogDescription>
            Upload a CSV file to import multiple contacts at once.
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
                    Select a CSV file with contact data to import
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
                    Your CSV should include these columns (first_name and last_name are required):
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
                    setParsedContacts([]);
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
                    <div className="text-2xl font-bold text-green-600">{validContacts.length}</div>
                    <div className="text-sm text-muted-foreground">Valid Contacts</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className="text-2xl font-bold text-red-600">{invalidContacts.length}</div>
                    <div className="text-sm text-muted-foreground">Invalid Contacts</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className="text-2xl font-bold">{parsedContacts.length}</div>
                    <div className="text-sm text-muted-foreground">Total Rows</div>
                  </CardContent>
                </Card>
              </div>

              {parsedContacts.length > 0 && (
                <div className="max-h-60 overflow-y-auto border rounded">
                  <div className="space-y-2 p-4">
                    {parsedContacts.slice(0, 10).map((contact, index) => (
                      <div key={index} className="flex items-center justify-between p-2 border rounded">
                        <div className="flex items-center space-x-2">
                          {contact.errors.length === 0 ? (
                            <CheckCircle className="h-4 w-4 text-green-500" />
                          ) : (
                            <AlertTriangle className="h-4 w-4 text-red-500" />
                          )}
                          <span className="font-medium">
                            {contact.first_name} {contact.last_name}
                          </span>
                          {contact.company && (
                            <Badge variant="secondary">{contact.company}</Badge>
                          )}
                        </div>
                        {contact.errors.length > 0 && (
                          <div className="text-xs text-red-600">
                            {contact.errors.join(', ')}
                          </div>
                        )}
                      </div>
                    ))}
                    {parsedContacts.length > 10 && (
                      <div className="text-sm text-muted-foreground text-center py-2">
                        ... and {parsedContacts.length - 10} more rows
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
                    setParsedContacts([]);
                    if (fileInputRef.current) {
                      fileInputRef.current.value = '';
                    }
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleImport}
                  disabled={importing || validContacts.length === 0}
                >
                  {importing ? 'Importing...' : `Import ${validContacts.length} Contacts`}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}