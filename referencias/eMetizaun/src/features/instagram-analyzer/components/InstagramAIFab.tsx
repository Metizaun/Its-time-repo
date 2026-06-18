import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";

type InstagramAIFabProps = {
  visible: boolean;
  disabled?: boolean;
  onClick: () => void;
};

export function InstagramAIFab({ visible, disabled, onClick }: InstagramAIFabProps) {
  if (!visible) {
    return null;
  }

  return (
    <Button
      type="button"
      size="icon"
      aria-label="Criar projeto com IA"
      onClick={onClick}
      disabled={disabled}
      className="absolute bottom-6 right-6 h-14 w-14 rounded-full border border-white/20 text-white shadow-lg transition-transform duration-150 hover:scale-105 focus-visible:ring-2 focus-visible:ring-offset-2"
      style={{
        background:
          "linear-gradient(135deg, #FEDA75 0%, #FA7E1E 25%, #D62976 50%, #962FBF 75%, #4F5BD5 100%)",
      }}
    >
      <Sparkles className="h-5 w-5" />
    </Button>
  );
}

