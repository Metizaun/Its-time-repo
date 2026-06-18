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
import { DealInsert, DEAL_STAGES, DEAL_STATUSES } from "@/hooks/useDeals";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useOrganizationContext } from "@/hooks/useOrganizationContext";

interface ImportDealsDialogProps {
  onImportDeals: (deals: DealInsert[]) => Promise<void>;
}

interface ParsedDeal extends DealInsert {
  rowNumber: number;
  errors: string[];
}

const CSV_HEADERS = [
  'title (or deal/deal_title)', 'description', 'value', 'status', 'stage', 'probability', 
  'expected_close_date', 'actual_close_date', 'notes'
];

export function ImportDealsDialog({ onImportDeals }: ImportDealsDialogProps) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parsedDeals, setParsedDeals] = useState<ParsedDeal[]>([]);
  const [importing, setImporting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { currentOrganization } = useOrganizationContext();

  // Quoted-field-aware CSV line parser
  const parseCSVLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      const next = line[i + 1];
      if (ch === '"') {
        if (inQuotes && next === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  };

  const parseCSV = (csvText: string): ParsedDeal[] => {
    const lines = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const nonEmpty = lines.filter(line => line.trim());
    if (nonEmpty.length === 0) return [];

    const headers = parseCSVLine(nonEmpty[0]).map(h => h.replace(/^\uFEFF/, '').toLowerCase().replace(/['"]/g, '').trim());
    const deals: ParsedDeal[] = [];

    for (let i = 1; i < nonEmpty.length; i++) {
      const values = parseCSVLine(nonEmpty[i]);
      const deal: ParsedDeal = {
        title: '',
        status: 'Active',
        stage: 'Prospecting',
        rowNumber: i + 1,
        errors: []
      };

      headers.forEach((header, index) => {
        const value = values[index]?.trim() || '';
        
        switch (header) {
          case 'title':
          case 'deal':
          case 'deal_title':
            deal.title = value;
            break;
          case 'description':
            deal.description = value || undefined;
            break;
          case 'value':
            if (value) {
              const dealValue = parseFloat(value.replace(/[,$£€¥]/g, ''));
              if (!isNaN(dealValue) && dealValue >= 0) {
                deal.value = dealValue;
              } else {
                deal.errors.push('Invalid deal value');
              }
            }
            break;
          case 'status':
            if (value) {
              if (DEAL_STATUSES.includes(value as any)) {
                deal.status = value;
              } else {
                deal.errors.push(`Invalid status. Must be one of: ${DEAL_STATUSES.join(', ')}`);
              }
            }
            break;
          case 'stage':
            if (value) {
              if (DEAL_STAGES.includes(value as any)) {
                deal.stage = value;
              } else {
                deal.errors.push(`Invalid stage. Must be one of: ${DEAL_STAGES.join(', ')}`);
              }
            }
            break;
          case 'probability':
            if (value) {
              const prob = parseInt(value);
              if (!isNaN(prob) && prob >= 0 && prob <= 100) {
                deal.probability = prob;
              } else {
                deal.errors.push('Probability must be between 0 and 100');
              }
            }
            break;
          case 'expected_close_date':
            if (value) {
              const date = new Date(value);
              if (!isNaN(date.getTime())) {
                deal.expected_close_date = value;
              } else {
                deal.errors.push('Invalid expected close date format');
              }
            }
            break;
          case 'actual_close_date':
            if (value) {
              const date = new Date(value);
              if (!isNaN(date.getTime())) {
                deal.actual_close_date = value;
              } else {
                deal.errors.push('Invalid actual close date format');
              }
            }
            break;
          case 'notes':
            deal.notes = value || undefined;
            break;
        }
      });

      // Validate required fields
      if (!deal.title) {
        deal.errors.push('Deal title is required');
      }

      deals.push(deal);
    }

    return deals;
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
      setParsedDeals(parsed);
      setShowPreview(true);
    };
    reader.readAsText(selectedFile);
  };

  const handleImport = async () => {
    const validDeals = parsedDeals
      .filter(deal => deal.title && deal.errors.length === 0)
      .map(({ rowNumber, errors, ...rest }) => rest);

    if (validDeals.length === 0) {
      toast({
        title: "No valid deals",
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
      await onImportDeals(validDeals as DealInsert[]);
      
      // Reset state
      setFile(null);
      setParsedDeals([]);
      setShowPreview(false);
      setOpen(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      toast({
        title: "Import error",
        description: "Failed to import deals. Please try again.",
        variant: "destructive",
      });
    } finally {
      setImporting(false);
    }
  };

  const validDeals = parsedDeals.filter(c => c.title && c.errors.length === 0);
  const invalidDeals = parsedDeals.filter(c => !c.title || c.errors.length > 0);

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
          <DialogTitle>Import Deals from CSV</DialogTitle>
          <DialogDescription>
            Upload a CSV file to import multiple deals at once.
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
                    Select a CSV file with deal data to import
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
                    Your CSV should include these columns (title is required):
                  </p>
                  <div className="text-xs text-muted-foreground font-mono bg-muted p-2 rounded">
                    {CSV_HEADERS.join(', ')}
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    <p><strong>Valid statuses:</strong> {DEAL_STATUSES.join(', ')}</p>
                    <p><strong>Valid stages:</strong> {DEAL_STAGES.join(', ')}</p>
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
                    setParsedDeals([]);
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
                    <div className="text-2xl font-bold text-green-600">{validDeals.length}</div>
                    <div className="text-sm text-muted-foreground">Valid Deals</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className="text-2xl font-bold text-red-600">{invalidDeals.length}</div>
                    <div className="text-sm text-muted-foreground">Invalid Deals</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className="text-2xl font-bold">{parsedDeals.length}</div>
                    <div className="text-sm text-muted-foreground">Total Rows</div>
                  </CardContent>
                </Card>
              </div>

              {parsedDeals.length > 0 && (
                <div className="max-h-60 overflow-y-auto border rounded">
                  <div className="space-y-2 p-4">
                    {parsedDeals.slice(0, 10).map((deal, index) => (
                      <div key={index} className="flex items-center justify-between p-2 border rounded">
                        <div className="flex items-center space-x-2">
                          {deal.errors.length === 0 ? (
                            <CheckCircle className="h-4 w-4 text-green-500" />
                          ) : (
                            <AlertTriangle className="h-4 w-4 text-red-500" />
                          )}
                          <span className="font-medium">{deal.title || 'No title'}</span>
                          {deal.stage && (
                            <Badge variant="secondary">{deal.stage}</Badge>
                          )}
                        </div>
                        {deal.errors.length > 0 && (
                          <div className="text-xs text-red-600">
                            {deal.errors.join(', ')}
                          </div>
                        )}
                      </div>
                    ))}
                    {parsedDeals.length > 10 && (
                      <div className="text-sm text-muted-foreground text-center py-2">
                        ... and {parsedDeals.length - 10} more rows
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
                    setParsedDeals([]);
                    if (fileInputRef.current) {
                      fileInputRef.current.value = '';
                    }
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleImport}
                  disabled={importing || validDeals.length === 0}
                >
                  {importing ? 'Importing...' : `Import ${validDeals.length} Deals`}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}