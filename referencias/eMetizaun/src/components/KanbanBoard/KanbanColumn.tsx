import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { KanbanItem } from './KanbanItem';

interface KanbanColumnProps {
  column: {
    id: string;
    title: string;
    items: any[];
    color?: string;
    itemCount: number;
    totalValue: number;
  };
  isDragOver: boolean;
  renderItem: (item: any, isDragging?: boolean) => React.ReactNode;
  onItemClick?: (item: any) => void;
}

export const KanbanColumn: React.FC<KanbanColumnProps> = ({
  column,
  isDragOver,
  renderItem,
  onItemClick,
}) => {
  const { setNodeRef } = useDroppable({
    id: column.id,
  });

  return (
    <Card
      ref={setNodeRef}
      className={`
        w-80 flex-shrink-0 h-full flex flex-col transition-all duration-200
        ${isDragOver ? 'ring-2 ring-primary ring-offset-2 bg-accent/50 scale-105' : ''}
      `}
    >
      <CardHeader className="pb-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold truncate">
            {column.title}
          </CardTitle>
          <Badge 
            variant="secondary" 
            className={column.color || 'bg-gray-100 text-gray-800'}
          >
            {column.itemCount}
          </Badge>
        </div>
        
        {column.totalValue > 0 && (
          <div className="text-xs font-medium text-muted-foreground mt-1">
            Total: ${column.totalValue.toLocaleString()}
          </div>
        )}
      </CardHeader>

      <CardContent className="p-0 flex-1 overflow-hidden">
        <ScrollArea className="h-[calc(100vh-300px)]">
          <div className="min-h-[200px] space-y-3 p-4">
            <SortableContext 
              items={column.items.map(item => item.id)} 
              strategy={verticalListSortingStrategy}
            >
              {column.items.map((item) => (
                <KanbanItem
                  key={item.id}
                  item={item}
                  renderItem={renderItem}
                  onItemClick={onItemClick}
                />
              ))}
            </SortableContext>
            
            {column.items.length === 0 && (
              <div className="text-center text-muted-foreground py-8 border-2 border-dashed border-border rounded-lg transition-colors hover:border-primary/50">
                Drop items here
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
};
