// Generic Kanban types for reusable components

export interface KanbanItem {
  id: string;
  [key: string]: any; // Allow any additional properties
}

export interface KanbanColumn {
  id: string;
  title: string;
  items: KanbanItem[];
  color?: string;
  maxItems?: number;
  allowedItemTypes?: string[];
}

export interface KanbanConfig {
  columns: KanbanColumn[];
  views?: Record<string, string[]>; // view name -> column IDs
  enableMultiSelect?: boolean;
  enableColumnReorder?: boolean;
  enableItemCopy?: boolean;
}

export interface DragEndResult {
  itemId: string;
  fromColumn: string;
  toColumn: string;
  fromIndex: number;
  toIndex: number;
}

export interface KanbanViewConfig {
  columnDefinitions: Record<string, { 
    id: string; 
    title: string; 
    color?: string;
    maxItems?: number;
  }>;
  views?: Record<string, string[]>;
  defaultView?: string;
}
