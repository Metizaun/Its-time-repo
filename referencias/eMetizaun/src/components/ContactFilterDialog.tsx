import { useState } from "react";
import { Filter } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";

export interface FilterOptions {
  companies: string[];
}

interface ContactFilterDialogProps {
  filters: FilterOptions;
  onFiltersChange: (filters: FilterOptions) => void;
  availableCompanies: string[];
}

export function ContactFilterDialog({ filters, onFiltersChange, availableCompanies }: ContactFilterDialogProps) {
  const [open, setOpen] = useState(false);
  const [tempFilters, setTempFilters] = useState<FilterOptions>(filters);

  const handleCompanyChange = (company: string, checked: boolean) => {
    const newCompanies = checked 
      ? [...tempFilters.companies, company]
      : tempFilters.companies.filter(c => c !== company);
    
    setTempFilters({ ...tempFilters, companies: newCompanies });
  };

  const handleApply = () => {
    onFiltersChange(tempFilters);
    setOpen(false);
  };

  const handleClear = () => {
    const clearedFilters = { companies: [] };
    setTempFilters(clearedFilters);
    onFiltersChange(clearedFilters);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Filter className="mr-2 h-4 w-4" />
          Filter
          {filters.companies.length > 0 && (
            <span className="ml-1 bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 text-xs">
              {filters.companies.length}
            </span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Filter Contacts</DialogTitle>
          <DialogDescription>
            Filter contacts by company.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {availableCompanies.length > 0 ? (
            <div className="space-y-3">
              <Label className="text-sm font-medium">Companies</Label>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {availableCompanies.map((company) => (
                  <div key={company} className="flex items-center space-x-2">
                    <Checkbox
                      id={`company-${company}`}
                      checked={tempFilters.companies.includes(company)}
                      onCheckedChange={(checked) => handleCompanyChange(company, checked as boolean)}
                    />
                    <Label htmlFor={`company-${company}`} className="text-sm">
                      {company}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center text-muted-foreground py-8">
              No companies to filter by yet. Add contacts with companies to see filter options.
            </div>
          )}

          <div className="flex justify-end space-x-2 pt-4">
            <Button type="button" variant="outline" onClick={handleClear}>
              Clear All
            </Button>
            <Button type="button" onClick={handleApply}>
              Apply Filters
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}