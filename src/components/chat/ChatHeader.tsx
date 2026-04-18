import { Info } from "lucide-react";

interface ChatHeaderProps {
  leadName: string;
  instanceName?: string | null;
  onOpenDetails?: () => void;
}

export function ChatHeader({ 
  leadName, 
  instanceName,
  onOpenDetails 
}: ChatHeaderProps) {
  const initial = leadName.charAt(0).toUpperCase();

  return (
    <div className="border-b border-white/5 px-5 py-3 flex items-center justify-between bg-transparent">
      <div className="flex items-center gap-3">
        {/* Avatar com anel accent */}
        <div className="w-10 h-10 rounded-full bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/20 flex items-center justify-center">
          <span className="text-sm font-bold text-[var(--color-accent)]">{initial}</span>
        </div>
        <div>
          <h2 className="font-bold text-white text-base leading-tight">{leadName}</h2>
          {instanceName && (
            <span className="text-[10px] text-[var(--color-text-secondary)] uppercase tracking-widest font-semibold">
              {instanceName}
            </span>
          )}
        </div>
      </div>

      {onOpenDetails && (
        <button
          onClick={onOpenDetails}
          className="w-9 h-9 rounded-xl flex items-center justify-center text-[var(--color-text-secondary)] hover:text-white hover:bg-white/5 transition-all duration-200"
        >
          <Info className="w-[18px] h-[18px]" />
        </button>
      )}
    </div>
  );
}