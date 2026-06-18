import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Check, Trash2, Filter, AlertCircle, CheckCircle, Info, AlertTriangle, X, TestTube } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useNotifications } from "@/hooks/useNotifications";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useOrganizationContext } from "@/hooks/useOrganizationContext";

export default function Notifications() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<'all' | 'unread' | 'read'>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const { toast } = useToast();
  const { user } = useAuth();
  const { currentOrganization } = useOrganizationContext();
  
  const {
    notifications,
    unreadCount,
    loading,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    clearAll,
  } = useNotifications();

  // Test function to create a sample notification
  const createTestNotification = async () => {
    if (!user?.id || !currentOrganization?.id) {
      toast({
        title: "Error",
        description: "User not authenticated or no organization selected",
        variant: "destructive",
      });
      return;
    }

    try {
      const { error } = await supabase.rpc('create_notification', {
        p_user_id: user.id,
        p_organization_id: currentOrganization.id,
        p_title: 'Test Notification 🧪',
        p_message: 'This is a test notification to verify the system is working correctly.',
        p_type: 'system',
        p_severity: 'info',
        p_action_url: '/notifications',
        p_metadata: {
          test: true,
          created_at: new Date().toISOString()
        }
      });

      if (error) throw error;

      toast({
        title: "Success",
        description: "Test notification created successfully!",
      });
    } catch (error) {
      console.error('Error creating test notification:', error);
      toast({
        title: "Error",
        description: "Failed to create test notification",
        variant: "destructive",
      });
    }
  };

  const filteredNotifications = notifications.filter(n => {
    if (filter === 'unread' && n.read) return false;
    if (filter === 'read' && !n.read) return false;
    if (typeFilter !== 'all' && n.type !== typeFilter) return false;
    return true;
  });

  const handleNotificationClick = async (notification: any) => {
    if (!notification.read) {
      await markAsRead(notification.id);
    }
    
    if (notification.action_url) {
      navigate(notification.action_url);
    }
  };

  const getIcon = (type: string, severity: string) => {
    if (severity === 'error') return <AlertCircle className="h-5 w-5 text-red-500" />;
    if (severity === 'warning') return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
    if (severity === 'success') return <CheckCircle className="h-5 w-5 text-green-500" />;
    
    switch (type) {
      case 'deal_won':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'deal_lost':
        return <X className="h-5 w-5 text-red-500" />;
      case 'task_assigned':
      case 'task_reminder':
        return <AlertCircle className="h-5 w-5 text-blue-500" />;
      default:
        return <Info className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'deal_won':
        return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300';
      case 'deal_lost':
        return 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300';
      case 'task_assigned':
      case 'task_reminder':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300';
      case 'lead_assigned':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-300';
      case 'mention':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  const formatType = (type: string) => {
    return type.split('_').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  };

  const notificationTypes = [
    { value: 'all', label: 'All Types' },
    { value: 'deal_won', label: 'Deal Won' },
    { value: 'deal_lost', label: 'Deal Lost' },
    { value: 'task_assigned', label: 'Task Assigned' },
    { value: 'task_reminder', label: 'Task Reminder' },
    { value: 'lead_assigned', label: 'Lead Assigned' },
    { value: 'mention', label: 'Mention' },
    { value: 'system', label: 'System' },
  ];

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Notifications</h1>
          <p className="text-muted-foreground">Loading your notifications...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Notifications</h1>
          <p className="text-muted-foreground">
            Stay updated with all your important activities and alerts
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <Badge variant="secondary" className="text-sm px-3 py-1">
              {unreadCount} unread
            </Badge>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as any)} className="w-auto">
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="unread">Unread</TabsTrigger>
            <TabsTrigger value="read">Read</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[180px]">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Filter by type" />
            </SelectTrigger>
            <SelectContent>
              {notificationTypes.map(type => (
                <SelectItem key={type.value} value={type.value}>
                  {type.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>


          {unreadCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={markAllAsRead}
            >
              <Check className="h-4 w-4 mr-2" />
              Mark all as read
            </Button>
          )}
          
          {notifications.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={clearAll}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Clear all
            </Button>
          )}
        </div>
      </div>

      {filteredNotifications.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Bell className="h-16 w-16 text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-medium mb-2">No notifications</h3>
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              {filter === 'unread' 
                ? "You're all caught up! No unread notifications."
                : filter === 'read'
                ? "No read notifications to show."
                : "You don't have any notifications yet. We'll notify you when something important happens."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredNotifications.map((notification) => (
            <Card
              key={notification.id}
              className={cn(
                "cursor-pointer hover:shadow-md transition-all",
                !notification.read && "border-primary/50 bg-primary/5"
              )}
              onClick={() => handleNotificationClick(notification)}
            >
              <CardContent className="p-4">
                <div className="flex gap-4">
                  <div className="flex-shrink-0">
                    {getIcon(notification.type, notification.severity)}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className={cn(
                            "text-sm font-medium",
                            !notification.read && "font-semibold"
                          )}>
                            {notification.title}
                          </h4>
                          {!notification.read && (
                            <Badge variant="default" className="text-[10px] px-1.5 py-0">
                              New
                            </Badge>
                          )}
                        </div>
                        
                        <p className="text-sm text-muted-foreground">
                          {notification.message}
                        </p>
                        
                        <div className="flex items-center gap-2 mt-2">
                          <Badge 
                            variant="secondary" 
                            className={cn("text-[10px] px-1.5 py-0", getTypeColor(notification.type))}
                          >
                            {formatType(notification.type)}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                          </span>
                          {notification.read && notification.read_at && (
                            <span className="text-xs text-muted-foreground">
                              • Read {formatDistanceToNow(new Date(notification.read_at), { addSuffix: true })}
                            </span>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-1">
                        {!notification.read && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              markAsRead(notification.id);
                            }}
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteNotification(notification.id);
                          }}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
