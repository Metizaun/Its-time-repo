import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface KanbanItemProps {
  item: any;
  renderItem: (item: any, isDragging?: boolean) => React.ReactNode;
  onItemClick?: (item: any) => void;
}

export const KanbanItem: React.FC<KanbanItemProps> = ({
  item,
  renderItem,
  onItemClick,
}) => {
  const { 
    attributes, 
    listeners, 
    setNodeRef, 
    transform, 
    transition,
    isDragging 
  } = useSortable({
    id: item.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className="cursor-grab active:cursor-grabbing focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded"
      onClick={() => onItemClick?.(item)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onItemClick?.(item);
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={`Drag ${item.title || item.name || 'item'}`}
    >
      {renderItem(item, isDragging)}
    </div>
  );
};
