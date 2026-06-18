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
import { DEAL_STAGES, DEAL_STATUSES } from "@/hooks/useDeals";

export interface DealFilterOptions {
  statuses: string[];
  stages: string[];
}

interface DealFilterDialogProps {
  filters: DealFilterOptions;
  onFiltersChange: (filters: DealFilterOptions) => void;
}

export function DealFilterDialog({ filters, onFiltersChange }: DealFilterDialogProps) {
  const [open, setOpen] = useState(false);
  const [tempFilters, setTempFilters] = useState<DealFilterOptions>(filters);

  const handleStatusChange = (status: string, checked: boolean) => {
    const newStatuses = checked 
      ? [...tempFilters.statuses, status]
      : tempFilters.statuses.filter(s => s !== status);
    
    setTempFilters({ ...tempFilters, statuses: newStatuses });
  };

  const handleStageChange = (stage: string, checked: boolean) => {
    const newStages = checked 
      ? [...tempFilters.stages, stage]
      : tempFilters.stages.filter(s => s !== stage);
    
    setTempFilters({ ...tempFilters, stages: newStages });
  };

  const handleApply = () => {
    onFiltersChange(tempFilters);
    setOpen(false);
  };

  const handleClear = () => {
    const clearedFilters = { statuses: [], stages: [] };
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
          {(filters.statuses.length > 0 || filters.stages.length > 0) && (
            <span className="ml-1 bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 text-xs">
              {filters.statuses.length + filters.stages.length}
            </span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Filter Deals</DialogTitle>
          <DialogDescription>
            Filter deals by status and stage.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6">
          <div className="space-y-3">
            <Label className="text-sm font-medium">Statuses</Label>
            <div className="space-y-2">
              {DEAL_STATUSES.map((status) => (
                <div key={status} className="flex items-center space-x-2">
                  <Checkbox
                    id={`status-${status}`}
                    checked={tempFilters.statuses.includes(status)}
                    onCheckedChange={(checked) => handleStatusChange(status, checked as boolean)}
                  />
                  <Label htmlFor={`status-${status}`} className="text-sm">
                    {status}
                  </Label>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <Label className="text-sm font-medium">Stages</Label>
            <div className="space-y-2">
              {DEAL_STAGES.map((stage) => (
                <div key={stage} className="flex items-center space-x-2">
                  <Checkbox
                    id={`stage-${stage}`}
                    checked={tempFilters.stages.includes(stage)}
                    onCheckedChange={(checked) => handleStageChange(stage, checked as boolean)}
                  />
                  <Label htmlFor={`stage-${stage}`} className="text-sm">
                    {stage}
                  </Label>
                </div>
              ))}
            </div>
          </div>

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