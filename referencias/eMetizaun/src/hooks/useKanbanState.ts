import { useState, useCallback, useMemo, useEffect } from 'react';
import { KanbanConfig, KanbanColumn, DragEndResult, KanbanViewConfig } from '@/types/kanban';

interface UseKanbanStateProps<T> {
  initialData: T[];
  getItemColumn: (item: T) => string;
  updateItemColumn: (itemId: string, newColumn: string) => Promise<boolean>;
  viewConfig: KanbanViewConfig;
}

export function useKanbanState<T extends { id: string }>({
  initialData,
  getItemColumn,
  updateItemColumn,
  viewConfig,
}: UseKanbanStateProps<T>) {
  const [items, setItems] = useState<T[]>(initialData);
  const [currentView, setCurrentView] = useState<string>(viewConfig.defaultView || 'all');
  const [isUpdating, setIsUpdating] = useState<Set<string>>(new Set());

  // Group items by column
  const groupedItems = useMemo(() => {
    return items.reduce((acc, item) => {
      const column = getItemColumn(item);
      if (!acc[column]) acc[column] = [];
      acc[column].push(item);
      return acc;
    }, {} as Record<string, T[]>);
  }, [items, getItemColumn]);

  // Build columns for current view
  const columns = useMemo((): KanbanColumn[] => {
    const viewColumns = viewConfig.views?.[currentView] || Object.keys(viewConfig.columnDefinitions);
    
    return viewColumns.map(columnId => ({
      id: columnId,
      title: viewConfig.columnDefinitions[columnId]?.title || columnId,
      color: viewConfig.columnDefinitions[columnId]?.color,
      maxItems: viewConfig.columnDefinitions[columnId]?.maxItems,
      items: groupedItems[columnId] || [],
    }));
  }, [groupedItems, viewConfig, currentView]);

  // Handle item movement with optimistic updates
  const handleItemMove = useCallback(async (result: DragEndResult): Promise<boolean> => {
    const { itemId, fromColumn, toColumn } = result;

    // Skip if moving to same column
    if (fromColumn === toColumn) return true;

    // Find the item to update
    const itemToUpdate = items.find(item => item.id === itemId);
    if (!itemToUpdate) return false;

    // Optimistic update
    setItems(prev => prev.map(item => {
      if (item.id === itemId) {
        // Create a new item with updated column
        const updatedItem = { ...item } as any;
        // We need to determine how to update the column field
        // This is a bit hacky but works for most cases
        const columnField = Object.keys(item).find(key => 
          getItemColumn(item) === (item as any)[key]
        );
        if (columnField) {
          updatedItem[columnField] = toColumn;
        }
        return updatedItem as T;
      }
      return item;
    }));

    setIsUpdating(prev => new Set(prev).add(itemId));

    try {
      const success = await updateItemColumn(itemId, toColumn);
      
      if (!success) {
        // Revert optimistic update
        setItems(prev => prev.map(item => 
          item.id === itemId ? itemToUpdate : item
        ));
        return false;
      }

      return true;
    } catch (error) {
      console.error('Failed to update item:', error);
      // Revert optimistic update
      setItems(prev => prev.map(item => 
        item.id === itemId ? itemToUpdate : item
      ));
      return false;
    } finally {
      setIsUpdating(prev => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    }
  }, [updateItemColumn, getItemColumn, items]);

  const config: KanbanConfig = {
    columns,
    views: viewConfig.views,
  };

  // Update items when initialData changes
  useEffect(() => {
    setItems(initialData);
  }, [initialData]);

  return {
    config,
    currentView,
    setCurrentView,
    handleItemMove,
    isUpdating,
    refreshData: () => setItems(initialData),
    availableViews: viewConfig.views ? Object.keys(viewConfig.views) : ['all'],
  };
}
