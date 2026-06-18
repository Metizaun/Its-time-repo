import React, { useState, useCallback, useMemo } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  rectIntersection,
} from '@dnd-kit/core';
import {
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';

import { KanbanColumn as KanbanColumnComponent } from './KanbanColumn';
import { KanbanConfig, DragEndResult } from '@/types/kanban';

interface KanbanBoardProps {
  config: KanbanConfig;
  renderItem: (item: any, isDragging?: boolean) => React.ReactNode;
  onItemMove?: (result: DragEndResult) => Promise<boolean> | boolean;
  onItemClick?: (item: any) => void;
  className?: string;
  loading?: boolean;
}

export const KanbanBoard: React.FC<KanbanBoardProps> = ({
  config,
  renderItem,
  onItemMove,
  onItemClick,
  className = '',
  loading = false,
}) => {
  const [activeItem, setActiveItem] = useState<any>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);

  // Enhanced sensor configuration for better UX
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Prevent accidental drags
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Memoize column data for performance
  const columnsData = useMemo(() => {
    return config.columns.map(column => ({
      ...column,
      itemCount: column.items.length,
      totalValue: column.items.reduce((sum, item) => {
        return sum + (item.value || item.estimated_value || 0);
      }, 0),
    }));
  }, [config.columns]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    
    // Find the item being dragged across all columns
    for (const column of config.columns) {
      const item = column.items.find(item => item.id === active.id);
      if (item) {
        setActiveItem(item);
        break;
      }
    }
  }, [config.columns]);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { over } = event;
    const targetColumnId = over?.id ? String(over.id) : null;
    setDragOverColumn(targetColumnId);
  }, []);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    
    setActiveItem(null);
    setDragOverColumn(null);

    if (!over || !onItemMove) return;

    // Find source and destination details
    let sourceColumn = '';
    let destinationColumn = '';
    let sourceIndex = -1;
    let destinationIndex = -1;

    // Find source column and index
    for (const column of config.columns) {
      const itemIndex = column.items.findIndex(item => item.id === active.id);
      if (itemIndex !== -1) {
        sourceColumn = column.id;
        sourceIndex = itemIndex;
        break;
      }
    }

    // Determine destination column
    const overIdStr = String(over.id);
    
    // Check if dropped directly on a column
    const targetColumn = config.columns.find(col => col.id === overIdStr);
    if (targetColumn) {
      destinationColumn = targetColumn.id;
      destinationIndex = targetColumn.items.length; // Add to end
    } else {
      // Check if dropped on an item within a column (use sortable context)
      if (over.data?.current?.sortable?.containerId) {
        destinationColumn = over.data.current.sortable.containerId;
        destinationIndex = over.data.current.sortable.index;
      }
    }

    // If no valid move or same position, return
    if (!sourceColumn || !destinationColumn || 
        (sourceColumn === destinationColumn && sourceIndex === destinationIndex)) {
      return;
    }

    // Call the move handler
    const result: DragEndResult = {
      itemId: String(active.id),
      fromColumn: sourceColumn,
      toColumn: destinationColumn,
      fromIndex: sourceIndex,
      toIndex: destinationIndex,
    };

    try {
      const success = await onItemMove(result);
      if (!success) {
        // Handle failed move (show error, revert UI, etc.)
        console.warn('Item move was rejected');
      }
    } catch (error) {
      console.error('Error moving item:', error);
    }
  }, [config.columns, onItemMove]);

  if (loading) {
    return (
      <div className={`flex gap-4 ${className}`}>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="w-64 h-96 bg-gray-100 animate-pulse rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className={`max-w-full ${className}`}>
      <DndContext
        sensors={sensors}
        collisionDetection={rectIntersection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100">
          {columnsData.map((column) => (
            <div key={column.id} className="flex-shrink-0">
              <KanbanColumnComponent
                column={column}
                isDragOver={dragOverColumn === column.id}
                renderItem={renderItem}
                onItemClick={onItemClick}
              />
            </div>
          ))}
        </div>

        <DragOverlay>
          {activeItem ? (
            <div className="rotate-2 opacity-90 transform-gpu">
              {renderItem(activeItem, true)}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
};
