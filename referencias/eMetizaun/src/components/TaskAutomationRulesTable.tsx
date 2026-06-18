import { useState } from "react";
import { Bot, Edit, Trash2, Play, Pause } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useTaskAutomation, TaskAutomationRule, TRIGGER_TYPES } from "@/hooks/useTaskAutomation";
import { useToast } from "@/hooks/use-toast";
import { EditTaskAutomationDialog } from "./EditTaskAutomationDialog";

interface TaskAutomationRulesTableProps {
  rules: TaskAutomationRule[];
  onRuleUpdated?: () => void;
}

export function TaskAutomationRulesTable({ rules, onRuleUpdated }: TaskAutomationRulesTableProps) {
  const { toggleRule, deleteRule } = useTaskAutomation();
  const { toast } = useToast();
  const [deletingRuleId, setDeletingRuleId] = useState<string | null>(null);
  const [editingRule, setEditingRule] = useState<TaskAutomationRule | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

  const handleToggleRule = async (id: string, enabled: boolean) => {
    try {
      await toggleRule(id, enabled);
      toast({
        title: "Success",
        description: `Rule ${enabled ? 'enabled' : 'disabled'} successfully`,
      });
      onRuleUpdated?.();
    } catch (error) {
      console.error('Failed to toggle rule:', error);
      toast({
        title: "Error",
        description: "Failed to update rule",
        variant: "destructive",
      });
    }
  };

  const handleDeleteRule = async (id: string) => {
    try {
      await deleteRule(id);
      toast({
        title: "Success",
        description: "Rule deleted successfully",
      });
      onRuleUpdated?.();
    } catch (error) {
      console.error('Failed to delete rule:', error);
      toast({
        title: "Error",
        description: "Failed to delete rule",
        variant: "destructive",
      });
    } finally {
      setDeletingRuleId(null);
    }
  };

  const getTriggerTypeLabel = (triggerType: string) => {
    const type = TRIGGER_TYPES.find(t => t.value === triggerType);
    return type?.label || triggerType;
  };

  const formatTaskTemplate = (template: any) => {
    return `${template.title} (${template.priority} priority, ${template.status})`;
  };

  if (rules.length === 0) {
    return (
      <div className="text-center py-8">
        <Bot className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium text-muted-foreground mb-2">No Smart Task Rules</h3>
        <p className="text-muted-foreground mb-4">
          Create your first automation rule to automatically generate tasks based on triggers.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Rule Name</TableHead>
            <TableHead>Trigger</TableHead>
            <TableHead>Task Template</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rules.map((rule) => (
            <TableRow key={rule.id}>
              <TableCell>
                <div>
                  <div className="font-medium">{rule.name}</div>
                  {rule.description && (
                    <div className="text-sm text-muted-foreground">{rule.description}</div>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <Badge variant="outline">
                  {getTriggerTypeLabel(rule.trigger_type)}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="text-sm">
                  {formatTaskTemplate(rule.task_template)}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center space-x-2">
                  <Switch
                    checked={rule.enabled}
                    onCheckedChange={(enabled) => handleToggleRule(rule.id, enabled)}
                  />
                  <span className="text-sm">
                    {rule.enabled ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditingRule(rule);
                      setIsEditDialogOpen(true);
                    }}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDeletingRuleId(rule.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Automation Rule</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to delete "{rule.name}"? This action cannot be undone.
                          Future triggers will no longer create tasks based on this rule.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => setDeletingRuleId(null)}>
                          Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => handleDeleteRule(rule.id)}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      
      <EditTaskAutomationDialog
        rule={editingRule}
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        onRuleUpdated={onRuleUpdated}
      />
    </div>
  );
}