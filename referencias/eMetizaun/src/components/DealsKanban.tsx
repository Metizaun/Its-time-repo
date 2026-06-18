import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, DollarSign, Calendar, User, TrendingUp, Loader2, MoreHorizontal, Edit, Trash2, Eye } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { formatDistanceToNow } from 'date-fns';
import { KanbanBoard } from '@/components/KanbanBoard';
import { useKanbanState } from '@/hooks/useKanbanState';
import { Deal } from '@/hooks/useDeals';
import { cn } from '@/lib/utils';
import { useState } from 'react';

const DEAL_COLUMNS = {
  'New': {
    id: 'New',
    title: 'New',
    color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300'
  },
  'Contacted': {
    id: 'Contacted',
    title: 'Contacted',
    color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300'
  },
  'Qualified': {
    id: 'Qualified',
    title: 'Qualified',
    color: 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300'
  },
  'Proposal': {
    id: 'Proposal',
    title: 'Proposal',
    color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-300'
  },
  'Negotiation': {
    id: 'Negotiation',
    title: 'Negotiation',
    color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-300'
  },
  'Closed Won': {
    id: 'Closed Won',
    title: 'Closed Won',
    color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300'
  },
  'Closed Lost': {
    id: 'Closed Lost',
    title: 'Closed Lost',
    color: 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300'
  },
};

const DEAL_VIEWS = {
  all: ['New', 'Contacted', 'Qualified', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost'],
  qualifying: ['New', 'Contacted', 'Qualified'],
  active: ['Qualified', 'Proposal', 'Negotiation'],
  closing: ['Negotiation', 'Closed Won', 'Closed Lost'],
};

interface DealsKanbanProps {
  deals: Deal[];
  loading: boolean;
  onUpdateDeal: (id: string, updates: Partial<Deal>) => Promise<Deal>;
  onEditDeal: (deal: Deal) => void;
  onViewDeal: (deal: Deal) => void;
  onDeleteDeal: (dealId: string) => Promise<void>;
}

export const DealsKanban: React.FC<DealsKanbanProps> = ({
  deals,
  loading,
  onUpdateDeal,
  onEditDeal,
  onViewDeal,
  onDeleteDeal,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Filter deals based on search and filters
  const filteredDeals = deals.filter(deal => {
    const matchesSearch =
      deal.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (deal.description && deal.description.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesStatus = statusFilter === 'all' || deal.stage === statusFilter;

    return matchesSearch && matchesStatus;
  });

  // Get unique values for filters
  const uniqueStatuses = Array.from(new Set(deals.map(deal => deal.stage)));

  const {
    config,
    currentView,
    setCurrentView,
    handleItemMove,
    isUpdating,
    availableViews,
  } = useKanbanState({
    initialData: filteredDeals,
    getItemColumn: (deal) => deal.stage,
    updateItemColumn: async (dealId, newStage) => {
      try {
        // Business logic: prevent moving closed deals back to active stages
        const deal = deals.find(d => d.id === dealId);
        if (deal && (deal.stage === "Closed Won" || deal.stage === "Closed Lost") && 
            !["Closed Won", "Closed Lost"].includes(newStage)) {
          console.log('Cannot move closed deal back to active stage');
          return false;
        }
        
        await onUpdateDeal(dealId, { stage: newStage });
        return true;
      } catch (error) {
        console.error('Error updating deal stage:', error);
        return false;
      }
    },
    viewConfig: {
      columnDefinitions: DEAL_COLUMNS,
      views: DEAL_VIEWS,
      defaultView: 'all',
    },
  });

  const getBadgeColor = (stage: string) => {
    return DEAL_COLUMNS[stage as keyof typeof DEAL_COLUMNS]?.color || "bg-muted text-muted-foreground";
  };

  const getProbabilityColor = (probability?: number) => {
    if (!probability) return "text-muted-foreground";
    if (probability >= 80) return "text-green-600 dark:text-green-400";
    if (probability >= 60) return "text-yellow-600 dark:text-yellow-400";
    if (probability >= 40) return "text-orange-600 dark:text-orange-400";
    return "text-red-600 dark:text-red-400";
  };

  const handleDelete = async (dealId: string) => {
    if (window.confirm('Are you sure you want to delete this deal? This action cannot be undone.')) {
      await onDeleteDeal(dealId);
    }
  };

  const renderDealCard = (deal: Deal, isDragging = false) => (
    <Card className={cn(
      "w-full cursor-pointer transition-all duration-200",
      isDragging ? 'shadow-2xl rotate-2 scale-105' : 'hover:shadow-md'
    )}>
      <CardContent className="p-4">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm truncate flex-1">
              {deal.title}
            </h3>
            <div className="flex items-center gap-2 flex-shrink-0">
              {isUpdating.has(deal.id) && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              <Badge className={getBadgeColor(deal.stage)}>
                {deal.stage}
              </Badge>
            </div>
          </div>

          {deal.description && (
            <p className="text-xs text-muted-foreground line-clamp-2">
              {deal.description}
            </p>
          )}

          <div className="space-y-2 text-xs text-muted-foreground">
            {deal.value && (
              <div className="flex items-center gap-2">
                <DollarSign className="h-3 w-3" />
                <span className="font-medium text-green-600">
                  ${deal.value.toLocaleString()}
                </span>
              </div>
            )}
            
            {deal.probability !== undefined && (
              <div className="flex items-center gap-2">
                <TrendingUp className="h-3 w-3" />
                <span className={cn("font-medium", getProbabilityColor(deal.probability))}>
                  {deal.probability}% probability
                </span>
              </div>
            )}
            
            {deal.expected_close_date && (
              <div className="flex items-center gap-2">
                <Calendar className="h-3 w-3" />
                <span>
                  Expected: {new Date(deal.expected_close_date).toLocaleDateString()}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(deal.created_at), { addSuffix: true })}
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
                  onViewDeal(deal);
                }}>
                  <Eye className="mr-2 h-4 w-4" />
                  View
                </DropdownMenuItem>
                <DropdownMenuItem onClick={(e) => {
                  e.stopPropagation();
                  onEditDeal(deal);
                }}>
                  <Edit className="mr-2 h-4 w-4" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(deal.id);
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
            {view === 'qualifying' ? 'Qualifying' :
             view === 'active' ? 'Active' :
             view === 'closing' ? 'Closing' :
             view.charAt(0).toUpperCase() + view.slice(1)}
          </Button>
        ))}
      </div>

      {/* Kanban Board */}
      <KanbanBoard
        config={config}
        renderItem={renderDealCard}
        onItemMove={handleItemMove}
        onItemClick={onViewDeal}
        loading={loading}
        className="min-h-[600px]"
      />
    </div>
  );
};
