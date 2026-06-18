import { AIChat } from '@/components/AIChat';
export default function AIAssistant() {
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <AIChat
        suggestions={[
          "Quantas tasks em aberto eu tenho?",
          "Empresa Acme tem quantas tasks em aberto?",
          "Mostre meus leads mais recentes",
          "Quais sao meus contatos mais recentes?",
        ]}
      />
    </div>
  );
}
