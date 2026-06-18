import { useState, useEffect } from "react";
import { Plus, Filter, Search, Bot, LayoutGrid, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AddTaskDialog } from "@/components/AddTaskDialog";
import { EditTaskDialog } from "@/components/EditTaskDialog";
import { TaskDetailDialog } from "@/components/TaskDetailDialog";
import { TasksKanban } from "@/components/TasksKanban";
import { TaskFilterDialog, TaskFilterOptions } from "@/components/TaskFilterDialog";
import { TaskAutomationDialog } from "@/components/TaskAutomationDialog";
import { TaskAutomationRulesTable } from "@/components/TaskAutomationRulesTable";
import { useTasks, Task, TaskInsert } from "@/hooks/useTasks";
import { useTaskAutomation } from "@/hooks/useTaskAutomation";
import { useToast } from "@/hooks/use-toast";

export default function Tasks() {
  const { tasks: hookTasks, loading: hookLoading, fetchTasks, createTask, updateTask, deleteTask } = useTasks();
  const { rules: automationRules, loading: automationLoading, fetchRules } = useTaskAutomation();
  const { toast } = useToast();

  const [tasks, setTasks] = useState<Task[]>(hookTasks);
  const [filteredTasks, setFilteredTasks] = useState<Task[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [editTaskOpen, setEditTaskOpen] = useState(false);
  const [viewTaskOpen, setViewTaskOpen] = useState(false);
  const [filters, setFilters] = useState<TaskFilterOptions>({
    statuses: [],
    priorities: [],
  });
  const [loading, setLoading] = useState(hookLoading);
  const [activeTab, setActiveTab] = useState("tasks");
  const [viewMode, setViewMode] = useState<'table' | 'kanban'>('table');

  // Sync tasks from hook with local state for filtering
  useEffect(() => {
    setTasks(hookTasks);
    setLoading(hookLoading);
  }, [hookTasks, hookLoading]);

  useEffect(() => {
    filterTasks();
  }, [tasks, searchTerm, filters]);

  const loadTasks = async () => {
    try {
      setLoading(true);
      await fetchTasks();
    } catch (error) {
      console.error('Failed to load tasks:', error);
      toast({
        title: "Error",
        description: "Failed to load tasks",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const filterTasks = () => {
    let filtered = tasks;

    // Apply search filter
    if (searchTerm) {
      filtered = filtered.filter(task =>
        task.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        task.description?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Apply status filter
    if (filters.statuses.length > 0) {
      filtered = filtered.filter(task => filters.statuses.includes(task.status));
    }

    // Apply priority filter
    if (filters.priorities.length > 0) {
      filtered = filtered.filter(task => filters.priorities.includes(task.priority));
    }

    setFilteredTasks(filtered);
  };

  const handleAddTask = async (taskData: TaskInsert) => {
    try {
      const newTask = await createTask(taskData);
      setTasks([newTask, ...tasks]);
      toast({
        title: "Success",
        description: "Task created successfully",
      });
    } catch (error) {
      console.error('Failed to create task:', error);
      toast({
        title: "Error",
        description: "Failed to create task",
        variant: "destructive",
      });
    }
  };

  const handleEditTask = async (id: string, updates: Partial<TaskInsert>) => {
    try {
      const updatedTask = await updateTask(id, updates);
      setTasks(tasks.map(task => task.id === id ? updatedTask : task));
      toast({
        title: "Success",
        description: "Task updated successfully",
      });
    } catch (error) {
      console.error('Failed to update task:', error);
      toast({
        title: "Error",
        description: "Failed to update task",
        variant: "destructive",
      });
    }
  };

  const handleDeleteTask = async (id: string) => {
    try {
      await deleteTask(id);
      setTasks(tasks.filter(task => task.id !== id));
      toast({
        title: "Success",
        description: "Task deleted successfully",
      });
    } catch (error) {
      console.error('Failed to delete task:', error);
      toast({
        title: "Error",
        description: "Failed to delete task",
        variant: "destructive",
      });
    }
  };

  const openEditDialog = (task: Task) => {
    setSelectedTask(task);
    setEditTaskOpen(true);
  };

  const openViewDialog = (task: Task) => {
    setSelectedTask(task);
    setViewTaskOpen(true);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Completed":
        return "bg-green-100 text-green-800";
      case "In Progress":
        return "bg-blue-100 text-blue-800";
      case "Pending":
        return "bg-yellow-100 text-yellow-800";
      case "Cancelled":
        return "bg-red-100 text-red-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "Urgent":
        return "bg-red-100 text-red-800";
      case "High":
        return "bg-orange-100 text-orange-800";
      case "Medium":
        return "bg-yellow-100 text-yellow-800";
      case "Low":
        return "bg-green-100 text-green-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  if (loading && automationLoading) {
    return <div className="space-y-6">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Tasks & Automation</h1>
        <div className="flex gap-2">
          <TaskAutomationDialog onRuleCreated={fetchRules} />
          <AddTaskDialog onAddTask={handleAddTask} />
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="automation" className="flex items-center gap-2">
            <Bot className="h-4 w-4" />
            Smart Rules
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tasks" className="space-y-4">
          <div className="flex gap-4 items-center">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search tasks..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8"
              />
            </div>
            <TaskFilterDialog
              filters={filters}
              onFiltersChange={setFilters}
            />
            <div className="flex gap-1 border rounded-md">
              <Button
                variant={viewMode === 'table' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('table')}
                className="rounded-r-none"
              >
                <List className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === 'kanban' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('kanban')}
                className="rounded-l-none"
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {viewMode === 'table' ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTasks.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8">
                        No tasks found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredTasks.map((task) => (
                      <TableRow 
                        key={task.id} 
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => openViewDialog(task)}
                      >
                        <TableCell>
                          <div>
                            <div className="font-medium">{task.title}</div>
                            {task.description && (
                              <div className="text-sm text-muted-foreground">{task.description}</div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={getStatusColor(task.status)}>{task.status}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className={getPriorityColor(task.priority)}>{task.priority}</Badge>
                        </TableCell>
                        <TableCell>
                          {task.due_date ? new Date(task.due_date).toLocaleDateString() : '-'}
                        </TableCell>
                        <TableCell>
                          {new Date(task.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                openEditDialog(task);
                              }}
                            >
                              Edit
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteTask(task.id);
                              }}
                            >
                              Delete
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          ) : (
            <TasksKanban
              tasks={filteredTasks}
              loading={loading}
              onUpdateTask={async (id, updates) => {
                await handleEditTask(id, updates);
                return tasks.find(t => t.id === id) || tasks[0]; // Return the updated task
              }}
              onEditTask={openEditDialog}
              onViewTask={openViewDialog}
              onDeleteTask={handleDeleteTask}
            />
          )}
        </TabsContent>

        <TabsContent value="automation" className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-xl font-semibold">Smart Task Rules</h2>
              <p className="text-muted-foreground">
                Automate task creation based on triggers and conditions
              </p>
            </div>
          </div>
          
          <TaskAutomationRulesTable 
            rules={automationRules} 
            onRuleUpdated={fetchRules}
          />
        </TabsContent>
      </Tabs>

      <EditTaskDialog
        task={selectedTask}
        open={editTaskOpen}
        onOpenChange={setEditTaskOpen}
        onEditTask={handleEditTask}
      />

      <TaskDetailDialog
        task={selectedTask}
        open={viewTaskOpen}
        onOpenChange={setViewTaskOpen}
        onEditTask={openEditDialog}
      />
    </div>
  );
}