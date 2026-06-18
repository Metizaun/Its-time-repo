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
import { TASK_STATUSES, TASK_PRIORITIES } from "@/hooks/useTasks";

export interface TaskFilterOptions {
  statuses: string[];
  priorities: string[];
}

interface TaskFilterDialogProps {
  filters: TaskFilterOptions;
  onFiltersChange: (filters: TaskFilterOptions) => void;
}

export function TaskFilterDialog({ filters, onFiltersChange }: TaskFilterDialogProps) {
  const [open, setOpen] = useState(false);
  const [tempFilters, setTempFilters] = useState<TaskFilterOptions>(filters);

  const handleStatusChange = (status: string, checked: boolean) => {
    const newStatuses = checked 
      ? [...tempFilters.statuses, status]
      : tempFilters.statuses.filter(s => s !== status);
    
    setTempFilters({ ...tempFilters, statuses: newStatuses });
  };

  const handlePriorityChange = (priority: string, checked: boolean) => {
    const newPriorities = checked 
      ? [...tempFilters.priorities, priority]
      : tempFilters.priorities.filter(p => p !== priority);
    
    setTempFilters({ ...tempFilters, priorities: newPriorities });
  };

  const handleApply = () => {
    onFiltersChange(tempFilters);
    setOpen(false);
  };

  const handleClear = () => {
    const clearedFilters = { statuses: [], priorities: [] };
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
          {(filters.statuses.length > 0 || filters.priorities.length > 0) && (
            <span className="ml-1 bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 text-xs">
              {filters.statuses.length + filters.priorities.length}
            </span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Filter Tasks</DialogTitle>
          <DialogDescription>
            Filter tasks by status and priority.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6">
          <div className="space-y-3">
            <Label className="text-sm font-medium">Statuses</Label>
            <div className="space-y-2">
              {TASK_STATUSES.map((status) => (
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
            <Label className="text-sm font-medium">Priorities</Label>
            <div className="space-y-2">
              {TASK_PRIORITIES.map((priority) => (
                <div key={priority} className="flex items-center space-x-2">
                  <Checkbox
                    id={`priority-${priority}`}
                    checked={tempFilters.priorities.includes(priority)}
                    onCheckedChange={(checked) => handlePriorityChange(priority, checked as boolean)}
                  />
                  <Label htmlFor={`priority-${priority}`} className="text-sm">
                    {priority}
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