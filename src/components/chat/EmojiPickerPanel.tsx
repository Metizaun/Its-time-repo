import EmojiPicker, {
  Categories,
  EmojiStyle,
  SuggestionMode,
  Theme,
  type EmojiClickData,
} from "emoji-picker-react";

const PORTUGUESE_CATEGORIES = [
  { category: Categories.SUGGESTED, name: "Recentes" },
  { category: Categories.SMILEYS_PEOPLE, name: "Smileys e pessoas" },
  { category: Categories.ANIMALS_NATURE, name: "Animais e natureza" },
  { category: Categories.FOOD_DRINK, name: "Comidas e bebidas" },
  { category: Categories.TRAVEL_PLACES, name: "Viagens e lugares" },
  { category: Categories.ACTIVITIES, name: "Atividades" },
  { category: Categories.OBJECTS, name: "Objetos" },
  { category: Categories.SYMBOLS, name: "Simbolos" },
  { category: Categories.FLAGS, name: "Bandeiras" },
];

export default function EmojiPickerPanel({ onSelect }: { onSelect: (emoji: string) => void }) {
  return (
    <EmojiPicker
      theme={Theme.LIGHT}
      emojiStyle={EmojiStyle.NATIVE}
      suggestedEmojisMode={SuggestionMode.RECENT}
      categories={PORTUGUESE_CATEGORIES}
      searchPlaceHolder="Pesquisar emoji"
      searchClearButtonLabel="Limpar pesquisa"
      previewConfig={{ showPreview: false }}
      lazyLoadEmojis
      width="min(350px, calc(100vw - 24px))"
      height="min(420px, calc(100dvh - 120px))"
      onEmojiClick={(emoji: EmojiClickData) => onSelect(emoji.emoji)}
    />
  );
}
