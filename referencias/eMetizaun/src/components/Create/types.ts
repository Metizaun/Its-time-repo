export type CreateMode = "text" | "image";
export type CreateActionMode = "create" | "improve";
export type CreateMessageType = "whatsapp" | "email" | "social";
export type CreatePreset = "default" | "new";
export type CreateAdvancedTone = "corporate" | "creative" | "empathetic" | "urgent";
export type CreateEmojiUsage = "more" | "standard" | "none";

export interface CreateDraftContent {
  subject: string;
  body: string;
}

export type CreateDrafts = Record<CreateMessageType, CreateDraftContent>;

export interface CreateChip {
  id: string;
  label: string;
  template: string;
}

export interface CreateSelectOption<T extends string> {
  value: T;
  label: string;
  description?: string;
}

