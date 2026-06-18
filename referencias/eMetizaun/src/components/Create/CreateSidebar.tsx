import { WandSparkles } from "lucide-react";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  ADVANCED_TONE_OPTIONS,
  CONTENT_TEMPLATE_CHIPS,
  EMOJI_USAGE_OPTIONS,
  MESSAGE_TYPE_OPTIONS,
  PRESET_OPTIONS,
  STYLE_TEMPLATE_CHIPS,
} from "@/components/Create/constants";
import type {
  CreateActionMode,
  CreateAdvancedTone,
  CreateEmojiUsage,
  CreateMessageType,
  CreateMode,
  CreatePreset,
} from "@/components/Create/types";

interface CreateSidebarProps {
  activeMode: CreateMode;
  actionMode: CreateActionMode;
  messageType: CreateMessageType;
  contentPrompt: string;
  emailSubject: string;
  stylePrompt: string;
  preset: CreatePreset;
  advancedTone: CreateAdvancedTone;
  emojiUsage: CreateEmojiUsage;
  customInstructions: string;
  onActiveModeChange: (mode: CreateMode) => void;
  onActionModeChange: (mode: CreateActionMode) => void;
  onMessageTypeChange: (type: CreateMessageType) => void;
  onContentPromptChange: (value: string) => void;
  onEmailSubjectChange: (value: string) => void;
  onStylePromptChange: (value: string) => void;
  onPresetChange: (value: CreatePreset) => void;
  onAdvancedToneChange: (value: CreateAdvancedTone) => void;
  onEmojiUsageChange: (value: CreateEmojiUsage) => void;
  onCustomInstructionsChange: (value: string) => void;
  onApplyContentTemplate: (template: string) => void;
  onApplyStyleTemplate: (template: string) => void;
  onCreateMessage: () => void;
}

export function CreateSidebar({
  activeMode,
  actionMode,
  messageType,
  contentPrompt,
  emailSubject,
  stylePrompt,
  preset,
  advancedTone,
  emojiUsage,
  customInstructions,
  onActiveModeChange,
  onActionModeChange,
  onMessageTypeChange,
  onContentPromptChange,
  onEmailSubjectChange,
  onStylePromptChange,
  onPresetChange,
  onAdvancedToneChange,
  onEmojiUsageChange,
  onCustomInstructionsChange,
  onApplyContentTemplate,
  onApplyStyleTemplate,
  onCreateMessage,
}: CreateSidebarProps) {
  const isEmail = messageType === "email";

  return (
    <aside className="flex min-h-0 flex-col rounded-lg border bg-card shadow-sm">
      <div className="border-b px-4 py-3">
        <h2 className="text-base font-semibold">Configuracoes</h2>
        <p className="text-xs text-muted-foreground">Personalize o conteudo antes de gerar.</p>
      </div>

      <ScrollArea className="h-[min(70vh,860px)] lg:h-[calc(100vh-13rem)]">
        <div className="space-y-5 p-4">
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Formato</Label>
              <Badge variant="outline" className="text-[10px]">
                Fase 1
              </Badge>
            </div>
            <ToggleGroup
              type="single"
              value={activeMode}
              onValueChange={(value) => {
                if (value === "text" || value === "image") {
                  onActiveModeChange(value);
                }
              }}
              className="grid grid-cols-2 gap-2"
            >
              <ToggleGroupItem value="text" className="rounded-md border text-sm">
                Texto
              </ToggleGroupItem>
              <ToggleGroupItem value="image" disabled className="rounded-md border text-sm opacity-50">
                Imagem
              </ToggleGroupItem>
            </ToggleGroup>
          </section>

          <section className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Modo de acao</Label>
            <ToggleGroup
              type="single"
              value={actionMode}
              onValueChange={(value) => {
                if (value === "create" || value === "improve") {
                  onActionModeChange(value);
                }
              }}
              className="grid grid-cols-2 gap-2"
            >
              <ToggleGroupItem value="create" className="rounded-md border text-sm">
                Criar
              </ToggleGroupItem>
              <ToggleGroupItem value="improve" className="rounded-md border text-sm">
                Melhorar
              </ToggleGroupItem>
            </ToggleGroup>
          </section>

          <section className="space-y-2">
            <Label htmlFor="message-type" className="text-xs uppercase tracking-wide text-muted-foreground">
              Tipo de mensagem
            </Label>
            <Select value={messageType} onValueChange={(value: CreateMessageType) => onMessageTypeChange(value)}>
              <SelectTrigger id="message-type">
                <SelectValue placeholder="Selecione um tipo" />
              </SelectTrigger>
              <SelectContent>
                {MESSAGE_TYPE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </section>

          <section className="space-y-3">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">Conteudo da mensagem</h3>
              <p className="text-xs text-muted-foreground">Descreva o contexto e clique em um template para acelerar.</p>
            </div>

            {isEmail && (
              <div className="space-y-2">
                <Label htmlFor="sidebar-email-subject">Assunto do e-mail</Label>
                <Input
                  id="sidebar-email-subject"
                  value={emailSubject}
                  onChange={(event) => onEmailSubjectChange(event.target.value)}
                  placeholder="Ex: Confirmacao da sua consulta"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="content-prompt">Prompt base</Label>
              <Textarea
                id="content-prompt"
                value={contentPrompt}
                onChange={(event) => onContentPromptChange(event.target.value)}
                placeholder="Descreva o conteudo principal da mensagem..."
                className="min-h-[120px]"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {CONTENT_TEMPLATE_CHIPS.map((chip) => (
                <Button
                  key={chip.id}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onApplyContentTemplate(chip.template)}
                  className="h-auto whitespace-normal rounded-full px-3 py-1 text-left text-xs"
                >
                  {chip.label}
                </Button>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">Estilo da mensagem</h3>
              <p className="text-xs text-muted-foreground">Defina voz, tom e posicionamento da comunicacao.</p>
            </div>

            <Textarea
              value={stylePrompt}
              onChange={(event) => onStylePromptChange(event.target.value)}
              placeholder="Ex: Tom acolhedor e profissional, com foco em clareza."
              className="min-h-[90px]"
            />

            <div className="flex flex-wrap gap-2">
              {STYLE_TEMPLATE_CHIPS.map((chip) => (
                <Button
                  key={chip.id}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onApplyStyleTemplate(chip.template)}
                  className="h-auto whitespace-normal rounded-full px-3 py-1 text-left text-xs"
                >
                  {chip.label}
                </Button>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <Label htmlFor="preset-select" className="text-xs uppercase tracking-wide text-muted-foreground">
              Presets
            </Label>
            <Select value={preset} onValueChange={(value: CreatePreset) => onPresetChange(value)}>
              <SelectTrigger id="preset-select">
                <SelectValue placeholder="Selecione um preset" />
              </SelectTrigger>
              <SelectContent>
                {PRESET_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </section>

          <Accordion type="single" collapsible className="w-full rounded-md border px-3">
            <AccordionItem value="advanced-options" className="border-none">
              <AccordionTrigger className="py-3 text-sm">Opcoes avancadas</AccordionTrigger>
              <AccordionContent className="space-y-4 pt-1">
                <div className="space-y-2">
                  <Label htmlFor="tone-select">Estilo e tom</Label>
                  <p className="text-xs text-muted-foreground">Defina um tom e estilo para a mensagem.</p>
                  <Select
                    value={advancedTone}
                    onValueChange={(value: CreateAdvancedTone) => onAdvancedToneChange(value)}
                  >
                    <SelectTrigger id="tone-select">
                      <SelectValue placeholder="Selecione o tom" />
                    </SelectTrigger>
                    <SelectContent>
                      {ADVANCED_TONE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="emoji-select">Emojis</Label>
                  <Select
                    value={emojiUsage}
                    onValueChange={(value: CreateEmojiUsage) => onEmojiUsageChange(value)}
                  >
                    <SelectTrigger id="emoji-select">
                      <SelectValue placeholder="Preferencia de emojis" />
                    </SelectTrigger>
                    <SelectContent>
                      {EMOJI_USAGE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="custom-instructions">Instrucoes personalizadas</Label>
                  <Textarea
                    id="custom-instructions"
                    value={customInstructions}
                    onChange={(event) => onCustomInstructionsChange(event.target.value)}
                    placeholder="Ex: Nunca usar a palavra cliente, sempre usar paciente."
                    className="min-h-[80px]"
                  />
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </ScrollArea>

      <div className="border-t p-4">
        <Button type="button" className="w-full gap-2" onClick={onCreateMessage}>
          <WandSparkles className="h-4 w-4" />
          Criar msg
        </Button>
      </div>
    </aside>
  );
}

