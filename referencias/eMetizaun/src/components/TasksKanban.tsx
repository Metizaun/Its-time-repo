import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Calendar, User, Clock, Loader2, MoreHorizontal, Edit, Trash2, Eye, AlertCircle } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { formatDistanceToNow } from 'date-fns';
import { KanbanBoard } from '@/components/KanbanBoard';
import { useKanbanState } from '@/hooks/useKanbanState';
import { Task } from '@/hooks/useTasks';
import { cn } from '@/lib/utils';
import { useState } from 'react';

const TASK_COLUMNS = {
  'Pending': {
    id: 'Pending',
    title: 'Pending',
    color: 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-300'
  },
  'In Progress': {
    id: 'In Progress',
    title: 'In Progress',
    color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300'
  },
  'Completed': {
    id: 'Completed',
    title: 'Completed',
    color: 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300'
  },
  'Cancelled': {
    id: 'Cancelled',
    title: 'Cancelled',
    color: 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300'
  },
};

const TASK_VIEWS = {
  all: ['Pending', 'In Progress', 'Completed', 'Cancelled'],
  active: ['Pending', 'In Progress'],
  completed: ['Completed', 'Cancelled'],
};

interface TasksKanbanProps {
  tasks: Task[];
  loading: boolean;
  onUpdateTask: (id: string, updates: Partial<Task>) => Promise<Task>;
  onEditTask: (task: Task) => void;
  onViewTask: (task: Task) => void;
  onDeleteTask: (taskId: string) => Promise<void>;
}

export const TasksKanban: React.FC<TasksKanbanProps> = ({
  tasks,
  loading,
  onUpdateTask,
  onEditTask,
  onViewTask,
  onDeleteTask,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Filter tasks based on search and filters
  const filteredTasks = tasks.filter(task => {
    const matchesSearch =
      task.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (task.description && task.description.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesStatus = statusFilter === 'all' || task.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const {
    config,
    currentView,
    setCurrentView,
    handleItemMove,
    isUpdating,
    availableViews,
  } = useKanbanState({
    initialData: filteredTasks,
    getItemColumn: (task) => task.status,
    updateItemColumn: async (taskId, newStatus) => {
      try {
        // Business logic: prevent moving completed/cancelled tasks back to active stages
        const task = tasks.find(t => t.id === taskId);
        if (task && (task.status === "Completed" || task.status === "Cancelled") && 
            !["Completed", "Cancelled"].includes(newStatus)) {
          console.log('Cannot move completed/cancelled task back to active stage');
          return false;
        }
        
        await onUpdateTask(taskId, { status: newStatus });
        return true;
      } catch (error) {
        console.error('Error updating task status:', error);
        return false;
      }
    },
    viewConfig: {
      columnDefinitions: TASK_COLUMNS,
      views: TASK_VIEWS,
      defaultView: 'all',
    },
  });

  const getBadgeColor = (status: string) => {
    return TASK_COLUMNS[status as keyof typeof TASK_COLUMNS]?.color || "bg-muted text-muted-foreground";
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'Urgent':
        return "text-red-600 dark:text-red-400";
      case 'High':
        return "text-orange-600 dark:text-orange-400";
      case 'Medium':
        return "text-yellow-600 dark:text-yellow-400";
      case 'Low':
        return "text-green-600 dark:text-green-400";
      default:
        return "text-muted-foreground";
    }
  };

  const getPriorityIcon = (priority: string) => {
    switch (priority) {
      case 'Urgent':
        return <AlertCircle className="h-3 w-3 text-red-500" />;
      case 'High':
        return <AlertCircle className="h-3 w-3 text-orange-500" />;
      case 'Medium':
        return <Clock className="h-3 w-3 text-yellow-500" />;
      case 'Low':
        return <Clock className="h-3 w-3 text-green-500" />;
      default:
        return <Clock className="h-3 w-3" />;
    }
  };

  const isOverdue = (dueDate?: string) => {
    if (!dueDate) return false;
    return new Date(dueDate) < new Date();
  };

  const handleDelete = async (taskId: string) => {
    if (window.confirm('Are you sure you want to delete this task? This action cannot be undone.')) {
      await onDeleteTask(taskId);
    }
  };

  const renderTaskCard = (task: Task, isDragging = false) => (
    <Card className={cn(
      "w-full cursor-pointer transition-all duration-200",
      isDragging ? 'shadow-2xl rotate-2 scale-105' : 'hover:shadow-md'
    )}>
      <CardContent className="p-4">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm truncate flex-1">
              {task.title}
            </h3>
            <div className="flex items-center gap-2 flex-shrink-0">
              {isUpdating.has(task.id) && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              <Badge className={getBadgeColor(task.status)}>
                {task.status}
              </Badge>
            </div>
          </div>

          {task.description && (
            <p className="text-xs text-muted-foreground line-clamp-2">
              {task.description}
            </p>
          )}

          <div className="space-y-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              {getPriorityIcon(task.priority)}
              <span className={cn("font-medium", getPriorityColor(task.priority))}>
                {task.priority} Priority
              </span>
            </div>
            
            {task.due_date && (
              <div className="flex items-center gap-2">
                <Calendar className="h-3 w-3" />
                <span className={cn(
                  isOverdue(task.due_date) && task.status !== 'Completed' && task.status !== 'Cancelled'
                    ? "text-red-600 font-medium" 
                    : ""
                )}>
                  Due: {new Date(task.due_date).toLocaleDateString()}
                  {isOverdue(task.due_date) && task.status !== 'Completed' && task.status !== 'Cancelled' && " (Overdue)"}
                </span>
              </div>
            )}

            {task.assigned_to && (
              <div className="flex items-center gap-2">
                <User className="h-3 w-3" />
                <span>Assigned</span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(task.created_at), { addSuffix: true })}
            </span>
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" className="h-6 w-6 p-0">
                  <MoreHorizontal className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={(e) => {
                  e.stopPropagation();
                  onViewTask(task);
                }}>
                  <Eye className="mr-2 h-4 w-4" />
                  View
                </DropdownMenuItem>
                <DropdownMenuItem onClick={(e) => {
                  e.stopPropagation();
                  onEditTask(task);
                }}>
                  <Edit className="mr-2 h-4 w-4" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(task.id);
                  }}
                  className="text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      {/* View Switcher */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">View:</span>
        {availableViews.map((view) => (
          <Button
            key={view}
            variant={currentView === view ? 'default' : 'outline'}
            size="sm"
            onClick={() => setCurrentView(view)}
          >
            {view === 'active' ? 'Active' :
             view === 'completed' ? 'Completed' :
             view.charAt(0).toUpperCase() + view.slice(1)}
          </Button>
        ))}
      </div>

      {/* Kanban Board */}
      <KanbanBoard
        config={config}
        renderItem={renderTaskCard}
        onItemMove={handleItemMove}
        onItemClick={onViewTask}
        loading={loading}
        className="min-h-[600px]"
      />
    </div>
  );
};