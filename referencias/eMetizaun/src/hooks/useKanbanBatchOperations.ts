import { useState, useCallback } from 'react';

export function useKanbanBatchOperations<T extends { id: string }>() {
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);

  const toggleItemSelection = useCallback((itemId: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback((items: T[]) => {
    setSelectedItems(new Set(items.map(item => item.id)));
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedItems(new Set());
  }, []);

  const batchUpdate = useCallback(async (
    updates: Record<string, any>,
    onUpdate: (itemId: string, updates: Record<string, any>) => Promise<boolean>
  ) => {
    if (selectedItems.size === 0) return { total: 0, successful: 0, failed: 0 };

    setIsProcessing(true);
    const results = await Promise.allSettled(
      Array.from(selectedItems).map(itemId => onUpdate(itemId, updates))
    );

    const successCount = results.filter(result => 
      result.status === 'fulfilled' && result.value
    ).length;

    setIsProcessing(false);
    clearSelection();

    return {
      total: selectedItems.size,
      successful: successCount,
      failed: selectedItems.size - successCount,
    };
  }, [selectedItems, clearSelection]);

  const batchDelete = useCallback(async (
    onDelete: (itemId: string) => Promise<boolean>
  ) => {
    if (selectedItems.size === 0) return { total: 0, successful: 0, failed: 0 };

    setIsProcessing(true);
    const results = await Promise.allSettled(
      Array.from(selectedItems).map(itemId => onDelete(itemId))
    );

    const successCount = results.filter(result => 
      result.status === 'fulfilled' && result.value
    ).length;

    setIsProcessing(false);
    clearSelection();

    return {
      total: selectedItems.size,
      successful: successCount,
      failed: selectedItems.size - successCount,
    };
  }, [selectedItems, clearSelection]);

  return {
    selectedItems,
    isProcessing,
    toggleItemSelection,
    selectAll,
    clearSelection,
    batchUpdate,
    batchDelete,
    hasSelection: selectedItems.size > 0,
    selectionCount: selectedItems.size,
  };
}
