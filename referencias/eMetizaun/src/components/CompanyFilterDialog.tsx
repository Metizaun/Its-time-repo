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

export interface CompanyFilterOptions {
  industries: string[];
}

interface CompanyFilterDialogProps {
  filters: CompanyFilterOptions;
  onFiltersChange: (filters: CompanyFilterOptions) => void;
  availableIndustries: string[];
}

export function CompanyFilterDialog({ filters, onFiltersChange, availableIndustries }: CompanyFilterDialogProps) {
  const [open, setOpen] = useState(false);
  const [tempFilters, setTempFilters] = useState<CompanyFilterOptions>(filters);

  const handleIndustryChange = (industry: string, checked: boolean) => {
    const newIndustries = checked 
      ? [...tempFilters.industries, industry]
      : tempFilters.industries.filter(i => i !== industry);
    
    setTempFilters({ ...tempFilters, industries: newIndustries });
  };

  const handleApply = () => {
    onFiltersChange(tempFilters);
    setOpen(false);
  };

  const handleClear = () => {
    const clearedFilters = { industries: [] };
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
          {filters.industries.length > 0 && (
            <span className="ml-1 bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 text-xs">
              {filters.industries.length}
            </span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Filter Companies</DialogTitle>
          <DialogDescription>
            Filter companies by industry.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {availableIndustries.length > 0 ? (
            <div className="space-y-3">
              <Label className="text-sm font-medium">Industries</Label>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {availableIndustries.map((industry) => (
                  <div key={industry} className="flex items-center space-x-2">
                    <Checkbox
                      id={`industry-${industry}`}
                      checked={tempFilters.industries.includes(industry)}
                      onCheckedChange={(checked) => handleIndustryChange(industry, checked as boolean)}
                    />
                    <Label htmlFor={`industry-${industry}`} className="text-sm">
                      {industry}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center text-muted-foreground py-8">
              No industries to filter by yet. Add companies with industries to see filter options.
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