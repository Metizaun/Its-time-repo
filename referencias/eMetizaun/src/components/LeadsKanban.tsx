import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Mail, Building, MapPin, Star, Loader2, MoreHorizontal, Edit, Trash2, Eye } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { formatDistanceToNow } from 'date-fns';
import { KanbanBoard } from '@/components/KanbanBoard';
import { useKanbanState } from '@/hooks/useKanbanState';
import { Lead } from '@/hooks/useLeads';
import { cn } from '@/lib/utils';

const LEAD_COLUMNS = {
  New: { 
    id: 'New', 
    title: 'New Leads', 
    color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300' 
  },
  Contacted: { 
    id: 'Contacted', 
    title: 'Contacted', 
    color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300' 
  },
  Qualified: { 
    id: 'Qualified', 
    title: 'Qualified', 
    color: 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300' 
  },
  Unqualified: { 
    id: 'Unqualified', 
    title: 'Unqualified', 
    color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-300' 
  },
  Lost: { 
    id: 'Lost', 
    title: 'Lost', 
    color: 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300' 
  },
};

const LEAD_VIEWS = {
  all: ['New', 'Contacted', 'Qualified', 'Unqualified', 'Lost'],
  active: ['New', 'Contacted', 'Qualified'],
  pipeline: ['Qualified'],
  closed: ['Unqualified', 'Lost'],
};

interface LeadsKanbanProps {
  leads: Lead[];
  loading: boolean;
  onUpdateLead: (id: string, updates: Partial<Lead>) => Promise<Lead>;
  onEditLead: (lead: Lead) => void;
  onViewLead: (lead: Lead) => void;
  onDeleteLead: (leadId: string) => Promise<void>;
}

export const LeadsKanban: React.FC<LeadsKanbanProps> = ({
  leads,
  loading,
  onUpdateLead,
  onEditLead,
  onViewLead,
  onDeleteLead,
}) => {

  const {
    config,
    currentView,
    setCurrentView,
    handleItemMove,
    isUpdating,
    availableViews,
  } = useKanbanState({
    initialData: leads,
    getItemColumn: (lead) => lead.status,
    updateItemColumn: async (leadId, newStatus) => {
      try {
        await onUpdateLead(leadId, { status: newStatus });
        return true;
      } catch (error) {
        console.error('Error updating lead status:', error);
        return false;
      }
    },
    viewConfig: {
      columnDefinitions: LEAD_COLUMNS,
      views: LEAD_VIEWS,
      defaultView: 'all',
    },
  });

  const getBadgeColor = (status: string) => {
    return LEAD_COLUMNS[status as keyof typeof LEAD_COLUMNS]?.color || "bg-muted text-muted-foreground";
  };

  const getScoreColor = (score?: number) => {
    if (!score) return "text-muted-foreground";
    if (score >= 80) return "text-green-600 dark:text-green-400";
    if (score >= 60) return "text-yellow-600 dark:text-yellow-400";
    if (score >= 40) return "text-orange-600 dark:text-orange-400";
    return "text-red-600 dark:text-red-400";
  };

  const handleDelete = async (leadId: string) => {
    if (window.confirm('Are you sure you want to delete this lead? This action cannot be undone.')) {
      await onDeleteLead(leadId);
    }
  };

  const renderLeadCard = (lead: Lead, isDragging = false) => (
    <Card className={cn(
      "w-full cursor-pointer transition-all duration-200",
      isDragging ? 'shadow-2xl rotate-2 scale-105' : 'hover:shadow-md'
    )}>
      <CardContent className="p-4">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm truncate flex-1">
              {lead.first_name} {lead.last_name}
            </h3>
            <div className="flex items-center gap-2 flex-shrink-0">
              {isUpdating.has(lead.id) && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              <Badge className={getBadgeColor(lead.status)}>
                {lead.status}
              </Badge>
            </div>
          </div>

          <div className="space-y-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <Mail className="h-3 w-3" />
              <span className="truncate">{lead.email}</span>
            </div>
            
            {lead.company && (
              <div className="flex items-center gap-2">
                <Building className="h-3 w-3" />
                <span className="truncate">{lead.company}</span>
              </div>
            )}
            
            {lead.location && (
              <div className="flex items-center gap-2">
                <MapPin className="h-3 w-3" />
                <span className="truncate">{lead.location}</span>
              </div>
            )}
            
            {lead.score !== undefined && (
              <div className="flex items-center gap-2">
                <Star className="h-3 w-3" />
                <span className={cn("font-medium", getScoreColor(lead.score))}>
                  Score: {lead.score}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(lead.created_at), { addSuffix: true })}
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
                  onViewLead(lead);
                }}>
                  <Eye className="mr-2 h-4 w-4" />
                  View
                </DropdownMenuItem>
                <DropdownMenuItem onClick={(e) => {
                  e.stopPropagation();
                  onEditLead(lead);
                }}>
                  <Edit className="mr-2 h-4 w-4" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(lead.id);
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
             view === 'pipeline' ? 'Pipeline' :
             view === 'closed' ? 'Closed' :
             view.charAt(0).toUpperCase() + view.slice(1)}
          </Button>
        ))}
      </div>

      {/* Kanban Board */}
      <KanbanBoard
        config={config}
        renderItem={renderLeadCard}
        onItemMove={handleItemMove}
        onItemClick={onViewLead}
        loading={loading}
        className="min-h-[600px]"
      />
    </div>
  );
};
