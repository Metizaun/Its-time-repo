import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

interface DragHandleProps {
  className?: string;
}

export function DragHandle({ className }: DragHandleProps) {
  return (
    <div 
      className={cn(
        "flex items-center justify-center w-5 h-5 text-muted-foreground hover:text-foreground transition-colors cursor-grab active:cursor-grabbing",
        className
      )}
    >
      <GripVertical className="h-3 w-3" />
    </div>
  );
}