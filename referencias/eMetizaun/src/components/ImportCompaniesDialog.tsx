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
import { CompanyInsert } from "@/hooks/useCompanies";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useOrganizationContext } from "@/hooks/useOrganizationContext";

interface ImportCompaniesDialogProps {
  onImportCompanies: (companies: CompanyInsert[]) => Promise<void>;
}

interface ParsedCompany extends CompanyInsert {
  rowNumber: number;
  errors: string[];
}

const CSV_HEADERS = [
  'name (or company/company_name)', 'industry', 'website (or url/web)', 
  'phone (or telephone)', 'email', 'address (or street)', 
  'city', 'state (or province)', 'country', 'postal_code (or zip/postcode)', 
  'employee_count (or employees/size)', 'annual_revenue (or revenue)', 
  'notes (or description/comments)'
];

export function ImportCompaniesDialog({ onImportCompanies }: ImportCompaniesDialogProps) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parsedCompanies, setParsedCompanies] = useState<ParsedCompany[]>([]);
  const [importing, setImporting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { currentOrganization, loading: orgLoading } = useOrganizationContext();

  // Helper function to parse CSV line respecting quoted fields
  const parseCSVLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];
      
      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          // Escaped quote
          current += '"';
          i++; // Skip next quote
        } else {
          // Toggle quote state
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        // Field separator
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    // Don't forget the last field
    result.push(current.trim());
    
    return result;
  };

  const parseCSV = (csvText: string): ParsedCompany[] => {
    // Normalize line endings and split into lines
    const lines = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const nonEmptyLines = lines.filter(line => line.trim());
    
    if (nonEmptyLines.length === 0) return [];

    // Parse headers
    const headerLine = nonEmptyLines[0];
    const headers = parseCSVLine(headerLine).map(h => h.replace(/^\uFEFF/, '').toLowerCase().replace(/['"]/g, '').trim());
    
    console.log('CSV Headers found:', headers); // Debug log
    
    const companies: ParsedCompany[] = [];

    for (let i = 1; i < nonEmptyLines.length; i++) {
      const line = nonEmptyLines[i];
      if (!line.trim()) continue; // Skip empty lines
      
      const values = parseCSVLine(line);
      
      console.log(`Row ${i} values:`, values); // Debug log
      
      const company: ParsedCompany = {
        name: '',
        rowNumber: i + 1,
        errors: []
      };

      headers.forEach((header, index) => {
        const value = values[index]?.trim() || '';
        
        switch (header) {
          case 'name':
          case 'company':
          case 'company name':
          case 'company_name':
            company.name = value;
            break;
          case 'industry':
            company.industry = value || undefined;
            break;
          case 'website':
          case 'url':
          case 'web':
            company.website = value || undefined;
            break;
          case 'phone':
          case 'phone number':
          case 'phone_number':
          case 'telephone':
            company.phone = value || undefined;
            break;
          case 'email':
          case 'email address':
          case 'email_address':
            company.email = value || undefined;
            break;
          case 'address':
          case 'street':
          case 'street address':
          case 'street_address':
            company.address = value || undefined;
            break;
          case 'city':
            company.city = value || undefined;
            break;
          case 'state':
          case 'province':
            company.state = value || undefined;
            break;
          case 'country':
            company.country = value || undefined;
            break;
          case 'postal_code':
          case 'zip':
          case 'zip code':
          case 'zip_code':
          case 'postcode':
            company.postal_code = value || undefined;
            break;
          case 'employee_count':
          case 'employees':
          case 'employee count':
          case 'number of employees':
          case 'number_of_employees':
          case 'size':
            if (value) {
              // Remove commas and parse
              const cleanValue = value.replace(/,/g, '');
              const count = parseInt(cleanValue);
              if (!isNaN(count) && count >= 0) {
                company.employee_count = count;
              } else if (value && value !== '-' && value !== 'N/A') {
                company.errors.push('Invalid employee count');
              }
            }
            break;
          case 'annual_revenue':
          case 'revenue':
          case 'annual revenue':
          case 'yearly revenue':
          case 'yearly_revenue':
            if (value) {
              // Remove currency symbols, commas, and parse
              const cleanValue = value.replace(/[,$£€¥]/g, '');
              const revenue = parseFloat(cleanValue);
              if (!isNaN(revenue) && revenue >= 0) {
                company.annual_revenue = revenue;
              } else if (value && value !== '-' && value !== 'N/A') {
                company.errors.push('Invalid annual revenue');
              }
            }
            break;
          case 'notes':
          case 'description':
          case 'comments':
            company.notes = value || undefined;
            break;
        }
      });

      // Validate required fields
      if (!company.name) {
        company.errors.push('Company name is required');
      }

      companies.push(company);
    }

    console.log('Parsed companies:', companies); // Debug log

    return companies;
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
      setParsedCompanies(parsed);
      setShowPreview(true);
    };
    reader.readAsText(selectedFile);
  };

  const handleImport = async () => {
    const validCompanies = parsedCompanies
      .filter(company => company.name && company.errors.length === 0)
      // Strip non-table fields before sending up
      .map(({ rowNumber, errors, ...rest }) => rest as CompanyInsert);

    if (validCompanies.length === 0) {
      toast({
        title: "No valid companies",
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

    console.log('ImportCompaniesDialog: Starting import with companies:', validCompanies);

    try {
      setImporting(true);
      await onImportCompanies(validCompanies);
      
      // Don't show success toast here since the parent component will handle it
      console.log('ImportCompaniesDialog: Import completed');
      
      // Reset state
      setFile(null);
      setParsedCompanies([]);
      setShowPreview(false);
      setOpen(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      console.error('ImportCompaniesDialog: Import error:', error);
      toast({
        title: "Import error",
        description: error instanceof Error ? error.message : "Failed to import companies. Please try again.",
        variant: "destructive",
      });
    } finally {
      setImporting(false);
    }
  };

  const validCompanies = parsedCompanies.filter(c => c.name && c.errors.length === 0);
  const invalidCompanies = parsedCompanies.filter(c => !c.name || c.errors.length > 0);

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
          <DialogTitle>Import Companies from CSV</DialogTitle>
          <DialogDescription>
            Upload a CSV file to import multiple companies at once.
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
                    Select a CSV file with company data to import
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
                    Your CSV should include these columns (name is required):
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
                    setParsedCompanies([]);
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
                    <div className="text-2xl font-bold text-green-600">{validCompanies.length}</div>
                    <div className="text-sm text-muted-foreground">Valid Companies</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className="text-2xl font-bold text-red-600">{invalidCompanies.length}</div>
                    <div className="text-sm text-muted-foreground">Invalid Companies</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className="text-2xl font-bold">{parsedCompanies.length}</div>
                    <div className="text-sm text-muted-foreground">Total Rows</div>
                  </CardContent>
                </Card>
              </div>

              {parsedCompanies.length > 0 && (
                <div className="max-h-60 overflow-y-auto border rounded">
                  <div className="space-y-2 p-4">
                    {parsedCompanies.slice(0, 10).map((company, index) => (
                      <div key={index} className="flex items-center justify-between p-2 border rounded">
                        <div className="flex items-center space-x-2">
                          {company.errors.length === 0 ? (
                            <CheckCircle className="h-4 w-4 text-green-500" />
                          ) : (
                            <AlertTriangle className="h-4 w-4 text-red-500" />
                          )}
                          <span className="font-medium">{company.name || 'No name'}</span>
                          {company.industry && (
                            <Badge variant="secondary">{company.industry}</Badge>
                          )}
                        </div>
                        {company.errors.length > 0 && (
                          <div className="text-xs text-red-600">
                            {company.errors.join(', ')}
                          </div>
                        )}
                      </div>
                    ))}
                    {parsedCompanies.length > 10 && (
                      <div className="text-sm text-muted-foreground text-center py-2">
                        ... and {parsedCompanies.length - 10} more rows
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
                    setParsedCompanies([]);
                    if (fileInputRef.current) {
                      fileInputRef.current.value = '';
                    }
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleImport}
                  disabled={importing || validCompanies.length === 0}
                >
                  {importing ? 'Importing...' : `Import ${validCompanies.length} Companies`}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}