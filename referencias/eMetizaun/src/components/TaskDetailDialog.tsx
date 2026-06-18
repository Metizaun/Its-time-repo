import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { 
  Calendar, 
  User, 
  Building2, 
  Contact, 
  DollarSign, 
  Clock,
  AlertCircle,
  Edit
} from 'lucide-react';
import { Task } from '@/hooks/useTasks';
import { cn } from '@/lib/utils';

interface TaskDetailDialogProps {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEditTask: (task: Task) => void;
}

export const TaskDetailDialog: React.FC<TaskDetailDialogProps> = ({
  task,
  open,
  onOpenChange,
  onEditTask,
}) => {
  if (!task) return null;

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Pending':
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-300';
      case 'In Progress':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300';
      case 'Completed':
        return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300';
      case 'Cancelled':
        return 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'Urgent':
        return 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300';
      case 'High':
        return 'bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-300';
      case 'Medium':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300';
      case 'Low':
        return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  const getPriorityIcon = (priority: string) => {
    switch (priority) {
      case 'Urgent':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      case 'High':
        return <AlertCircle className="h-4 w-4 text-orange-500" />;
      case 'Medium':
        return <Clock className="h-4 w-4 text-yellow-500" />;
      case 'Low':
        return <Clock className="h-4 w-4 text-green-500" />;
      default:
        return <Clock className="h-4 w-4" />;
    }
  };

  const isOverdue = (dueDate?: string) => {
    if (!dueDate) return false;
    return new Date(dueDate) < new Date();
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-xl font-semibold">
              {task.title}
            </DialogTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onEditTask(task);
                onOpenChange(false);
              }}
            >
              <Edit className="h-4 w-4 mr-2" />
              Edit
            </Button>
          </div>
        </DialogHeader>

        <div className="space-y-6">
          {/* Status and Priority */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Status:</span>
              <Badge className={getStatusColor(task.status)}>
                {task.status}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              {getPriorityIcon(task.priority)}
              <span className="text-sm font-medium">Priority:</span>
              <Badge className={getPriorityColor(task.priority)}>
                {task.priority}
              </Badge>
            </div>
          </div>

          {/* Description */}
          {task.description && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Description</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {task.description}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Dates and Assignment */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {task.due_date && (
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <Calendar className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Due Date</p>
                      <p className={cn(
                        "text-sm",
                        isOverdue(task.due_date) && task.status !== 'Completed' && task.status !== 'Cancelled'
                          ? "text-red-600 font-medium" 
                          : "text-muted-foreground"
                      )}>
                        {formatDate(task.due_date)}
                        {isOverdue(task.due_date) && task.status !== 'Completed' && task.status !== 'Cancelled' && " (Overdue)"}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {task.assigned_to && (
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <User className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Assigned To</p>
                      <p className="text-sm text-muted-foreground">Team Member</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Related Items */}
          {(task.contact_id || task.company_id || task.deal_id) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Related Items</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {task.contact_id && (
                  <div className="flex items-center gap-3">
                    <Contact className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">Linked to Contact</span>
                  </div>
                )}
                {task.company_id && (
                  <div className="flex items-center gap-3">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">Linked to Company</span>
                  </div>
                )}
                {task.deal_id && (
                  <div className="flex items-center gap-3">
                    <DollarSign className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">Linked to Deal</span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Notes */}
          {task.notes && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {task.notes}
                </p>
              </CardContent>
            </Card>
          )}

          <Separator />

          {/* Timestamps */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-muted-foreground">
            <div>
              <span className="font-medium">Created:</span>
              <br />
              {formatDateTime(task.created_at)}
            </div>
            <div>
              <span className="font-medium">Last Updated:</span>
              <br />
              {formatDateTime(task.updated_at)}
            </div>
            {task.completed_at && (
              <div className="md:col-span-2">
                <span className="font-medium">Completed:</span>
                <br />
                {formatDateTime(task.completed_at)}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};