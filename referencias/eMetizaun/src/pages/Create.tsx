import { useMemo, useState } from "react";
import { PenTool } from "lucide-react";

import { CreateCanvas } from "@/components/Create/CreateCanvas";
import { CreateSidebar } from "@/components/Create/CreateSidebar";
import { DEFAULT_DRAFTS } from "@/components/Create/constants";
import type {
  CreateActionMode,
  CreateAdvancedTone,
  CreateDraftContent,
  CreateDrafts,
  CreateEmojiUsage,
  CreateMessageType,
  CreateMode,
  CreatePreset,
} from "@/components/Create/types";
import { useToast } from "@/hooks/use-toast";

function cloneDefaultDrafts(): CreateDrafts {
  return {
    whatsapp: { ...DEFAULT_DRAFTS.whatsapp },
    email: { ...DEFAULT_DRAFTS.email },
    social: { ...DEFAULT_DRAFTS.social },
  };
}

export default function Create() {
  const { toast } = useToast();

  const [activeMode, setActiveMode] = useState<CreateMode>("text");
  const [actionMode, setActionMode] = useState<CreateActionMode>("create");
  const [messageType, setMessageType] = useState<CreateMessageType>("whatsapp");
  const [drafts, setDrafts] = useState<CreateDrafts>(() => cloneDefaultDrafts());
  const [stylePrompt, setStylePrompt] = useState("");
  const [preset, setPreset] = useState<CreatePreset>("default");
  const [advancedTone, setAdvancedTone] = useState<CreateAdvancedTone>("empathetic");
  const [emojiUsage, setEmojiUsage] = useState<CreateEmojiUsage>("standard");
  const [customInstructions, setCustomInstructions] = useState("");

  const activeDraft = useMemo(() => drafts[messageType], [drafts, messageType]);

  const updateActiveDraft = (nextDraft: CreateDraftContent) => {
    setDrafts((previous) => ({
      ...previous,
      [messageType]: nextDraft,
    }));
  };

  const handleContentTemplate = (template: string) => {
    setDrafts((previous) => {
      const currentDraft = previous[messageType];
      const nextBody = currentDraft.body.trim() ? `${currentDraft.body}\n${template}` : template;
      return {
        ...previous,
        [messageType]: {
          ...currentDraft,
          body: nextBody,
        },
      };
    });
  };

  const handleCreateMessage = () => {
    toast({
      title: "Fase 1 ativa",
      description: "A interface esta pronta. A geracao por IA sera conectada na proxima fase.",
    });
  };

  const handleSaveTemplate = () => {
    toast({
      title: "Template pronto para salvar",
      description: "Persistencia ainda desativada nesta fase. Estado local mantido.",
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
          <PenTool className="h-7 w-7 text-primary" />
          Create
        </h1>
        <p className="text-muted-foreground">
          Painel de criacao de mensagens para clinicas. UI pronta e reativa, sem integracao de backend nesta fase.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <CreateSidebar
          activeMode={activeMode}
          actionMode={actionMode}
          messageType={messageType}
          contentPrompt={activeDraft.body}
          emailSubject={activeDraft.subject}
          stylePrompt={stylePrompt}
          preset={preset}
          advancedTone={advancedTone}
          emojiUsage={emojiUsage}
          customInstructions={customInstructions}
          onActiveModeChange={setActiveMode}
          onActionModeChange={setActionMode}
          onMessageTypeChange={setMessageType}
          onContentPromptChange={(value) => updateActiveDraft({ ...activeDraft, body: value })}
          onEmailSubjectChange={(value) => updateActiveDraft({ ...activeDraft, subject: value })}
          onStylePromptChange={setStylePrompt}
          onPresetChange={setPreset}
          onAdvancedToneChange={setAdvancedTone}
          onEmojiUsageChange={setEmojiUsage}
          onCustomInstructionsChange={setCustomInstructions}
          onApplyContentTemplate={handleContentTemplate}
          onApplyStyleTemplate={setStylePrompt}
          onCreateMessage={handleCreateMessage}
        />

        <CreateCanvas
          messageType={messageType}
          draft={activeDraft}
          onDraftChange={updateActiveDraft}
          onSaveTemplate={handleSaveTemplate}
        />
      </div>
    </div>
  );
}

