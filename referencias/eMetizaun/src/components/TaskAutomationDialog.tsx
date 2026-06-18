import { useState, useEffect } from "react";
import { Bot, Plus, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { TaskAutomationRuleInsert, TRIGGER_TYPES, useTaskAutomation } from "@/hooks/useTaskAutomation";
import { TASK_STATUSES, TASK_PRIORITIES } from "@/hooks/useTasks";

interface TaskAutomationDialogProps {
  onRuleCreated?: () => void;
}

export function TaskAutomationDialog({ onRuleCreated }: TaskAutomationDialogProps) {
  const [open, setOpen] = useState(false);
  const { createRule } = useTaskAutomation();
  
  const [formData, setFormData] = useState<TaskAutomationRuleInsert>({
    name: "",
    description: "",
    enabled: true,
    trigger_type: "deal_created",
    trigger_conditions: {},
    task_template: {
      title: "",
      description: "",
      status: "Pending",
      priority: "Medium",
      due_date_offset: 0,
      assign_to: "creator",
    },
  });

  const resetForm = () => {
    setFormData({
      name: "",
      description: "",
      enabled: true,
      trigger_type: "deal_created",
      trigger_conditions: {},
      task_template: {
        title: "",
        description: "",
        status: "Pending",
        priority: "Medium",
        due_date_offset: 0,
        assign_to: "creator",
      },
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createRule(formData);
      setOpen(false);
      resetForm();
      onRuleCreated?.();
    } catch (error) {
      console.error('Failed to create automation rule:', error);
    }
  };

  const renderTriggerConditions = () => {
    switch (formData.trigger_type) {
      case 'deal_stage_changed':
        return (
          <div className="grid gap-2">
            <Label>From Stage</Label>
            <Input
              placeholder="e.g., Qualification"
              value={formData.trigger_conditions?.from_stage || ""}
              onChange={(e) => setFormData({
                ...formData,
                trigger_conditions: {
                  ...formData.trigger_conditions,
                  from_stage: e.target.value
                }
              })}
            />
            <Label>To Stage</Label>
            <Input
              placeholder="e.g., Proposal"
              value={formData.trigger_conditions?.to_stage || ""}
              onChange={(e) => setFormData({
                ...formData,
                trigger_conditions: {
                  ...formData.trigger_conditions,
                  to_stage: e.target.value
                }
              })}
            />
          </div>
        );
      case 'birthday_approaching':
      case 'anniversary_approaching':
      case 'important_date_approaching':
        return (
          <div className="grid gap-2">
            <Label>Days Before Date</Label>
            <Input
              type="number"
              placeholder="e.g., 7"
              value={formData.trigger_conditions?.days_before || ""}
              onChange={(e) => setFormData({
                ...formData,
                trigger_conditions: {
                  ...formData.trigger_conditions,
                  days_before: parseInt(e.target.value) || 0
                }
              })}
            />
            <p className="text-xs text-muted-foreground">
              {formData.trigger_type === 'birthday_approaching' && 'Create tasks before contacts\' birthdays'}
              {formData.trigger_type === 'anniversary_approaching' && 'Create tasks before contacts\' anniversaries'}
              {formData.trigger_type === 'important_date_approaching' && 'Create tasks before contacts\' important dates'}
            </p>
          </div>
        );
      case 'date_based':
        return (
          <div className="grid gap-2">
            <Label>Trigger Days Before Due Date</Label>
            <Input
              type="number"
              placeholder="e.g., 7"
              value={formData.trigger_conditions?.days_before || ""}
              onChange={(e) => setFormData({
                ...formData,
                trigger_conditions: {
                  ...formData.trigger_conditions,
                  days_before: parseInt(e.target.value) || 0
                }
              })}
            />
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Bot className="mr-2 h-4 w-4" />
          Smart Tasks
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            Create Smart Task Rule
          </DialogTitle>
          <DialogDescription>
            Set up automated task creation based on triggers and conditions.
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Rule Details */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium">Rule Details</h3>
              <div className="flex items-center space-x-2">
                <Switch
                  checked={formData.enabled}
                  onCheckedChange={(enabled) => setFormData({ ...formData, enabled })}
                />
                <Label>Enabled</Label>
              </div>
            </div>
            
            <div className="grid gap-2">
              <Label htmlFor="name">Rule Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Follow-up after deal creation"
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Describe when and why this rule triggers"
                rows={2}
              />
            </div>
          </div>

          <Separator />

          {/* Trigger Configuration */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Trigger</h3>
            
            <div className="grid gap-2">
              <Label>Trigger Type</Label>
              <Select 
                value={formData.trigger_type} 
                onValueChange={(value: any) => setFormData({ 
                  ...formData, 
                  trigger_type: value,
                  trigger_conditions: {} // Reset conditions when trigger type changes
                })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRIGGER_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {renderTriggerConditions()}
          </div>

          <Separator />

          {/* Task Template */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Task Template</h3>
            
            <div className="grid gap-2">
              <Label htmlFor="task_title">Task Title *</Label>
              <Input
                id="task_title"
                value={formData.task_template.title}
                onChange={(e) => setFormData({
                  ...formData,
                  task_template: { ...formData.task_template, title: e.target.value }
                })}
                placeholder="e.g., Follow up with {{contact_name}}"
                required
              />
              <p className="text-xs text-muted-foreground">
                Use {`{{contact_name}}, {{company_name}}, {{deal_title}}, {{contact_birthday}}, {{contact_anniversary}}`} for dynamic values
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="task_description">Task Description</Label>
              <Textarea
                id="task_description"
                value={formData.task_template.description}
                onChange={(e) => setFormData({
                  ...formData,
                  task_template: { ...formData.task_template, description: e.target.value }
                })}
                placeholder="Detailed instructions for the task"
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Status</Label>
                <Select 
                  value={formData.task_template.status} 
                  onValueChange={(value) => setFormData({
                    ...formData,
                    task_template: { ...formData.task_template, status: value }
                  })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TASK_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="grid gap-2">
                <Label>Priority</Label>
                <Select 
                  value={formData.task_template.priority} 
                  onValueChange={(value) => setFormData({
                    ...formData,
                    task_template: { ...formData.task_template, priority: value }
                  })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TASK_PRIORITIES.map((priority) => (
                      <SelectItem key={priority} value={priority}>
                        {priority}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Due Date (days from trigger)</Label>
              <Input
                type="number"
                value={formData.task_template.due_date_offset || 0}
                onChange={(e) => setFormData({
                  ...formData,
                  task_template: { 
                    ...formData.task_template, 
                    due_date_offset: parseInt(e.target.value) || 0 
                  }
                })}
                placeholder="0"
                min="0"
              />
            </div>
          </div>

          <div className="flex justify-end space-x-2 pt-4">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Create Rule</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}