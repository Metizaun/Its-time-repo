import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Trash2, 
  Edit, 
  Move, 
  X, 
  CheckSquare, 
  Square,
  Loader2
} from 'lucide-react';

interface KanbanBatchActionsProps {
  selectedCount: number;
  isProcessing: boolean;
  availableColumns: Array<{ id: string; title: string }>;
  onBatchMove?: (columnId: string) => Promise<{ successful: number; failed: number; total: number }>;
  onBatchDelete?: () => Promise<{ successful: number; failed: number; total: number }>;
  onSelectAll?: () => void;
  onClearSelection?: () => void;
  className?: string;
}

export const KanbanBatchActions: React.FC<KanbanBatchActionsProps> = ({
  selectedCount,
  isProcessing,
  availableColumns,
  onBatchMove,
  onBatchDelete,
  onSelectAll,
  onClearSelection,
  className = '',
}) => {
  const [moveToColumn, setMoveToColumn] = React.useState<string>('');

  const handleBatchMove = async () => {
    if (!moveToColumn || !onBatchMove) return;
    
    try {
      const result = await onBatchMove(moveToColumn);
      // Reset selection
      setMoveToColumn('');
      // Could show toast notification here
      console.log(`Batch move completed: ${result.successful}/${result.total} successful`);
    } catch (error) {
      console.error('Batch move failed:', error);
    }
  };

  const handleBatchDelete = async () => {
    if (!onBatchDelete) return;
    
    if (window.confirm(`Are you sure you want to delete ${selectedCount} items? This action cannot be undone.`)) {
      try {
        const result = await onBatchDelete();
        console.log(`Batch delete completed: ${result.successful}/${result.total} successful`);
      } catch (error) {
        console.error('Batch delete failed:', error);
      }
    }
  };

  if (selectedCount === 0) {
    return null;
  }

  return (
    <div className={`flex items-center gap-3 p-3 bg-accent border rounded-lg ${className}`}>
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="px-2 py-1">
          {selectedCount} selected
        </Badge>
        
        <Button
          variant="ghost"
          size="sm"
          onClick={onSelectAll}
          className="h-8 px-2"
        >
          <CheckSquare className="h-4 w-4 mr-1" />
          All
        </Button>
        
        <Button
          variant="ghost"
          size="sm"
          onClick={onClearSelection}
          className="h-8 px-2"
        >
          <X className="h-4 w-4 mr-1" />
          Clear
        </Button>
      </div>

      <div className="flex items-center gap-2">
        {onBatchMove && (
          <div className="flex items-center gap-2">
            <Select value={moveToColumn} onValueChange={setMoveToColumn}>
              <SelectTrigger className="w-32 h-8">
                <SelectValue placeholder="Move to..." />
              </SelectTrigger>
              <SelectContent>
                {availableColumns.map(column => (
                  <SelectItem key={column.id} value={column.id}>
                    {column.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <Button
              size="sm"
              variant="outline"
              onClick={handleBatchMove}
              disabled={!moveToColumn || isProcessing}
              className="h-8"
            >
              {isProcessing ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <Move className="h-3 w-3 mr-1" />
              )}
              Move
            </Button>
          </div>
        )}
        
        {onBatchDelete && (
          <Button
            size="sm"
            variant="destructive"
            onClick={handleBatchDelete}
            disabled={isProcessing}
            className="h-8"
          >
            {isProcessing ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : (
              <Trash2 className="h-3 w-3 mr-1" />
            )}
            Delete
          </Button>
        )}
      </div>
    </div>
  );
};
