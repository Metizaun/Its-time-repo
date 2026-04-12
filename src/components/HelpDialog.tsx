import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom"; // 1. Importação necessária
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { HelpCircle, Keyboard, MousePointer, Palette, Download } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function HelpDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const location = useLocation(); // 2. Pegamos a localização atual
  const isChatPage = location.pathname === "/chat"; // 3. Verificamos se é o chat

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // O atalho '?' continua funcionando mesmo sem o botão visível
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        setIsOpen(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <>
      {/* 4. Renderização Condicional: O botão só aparece se NÃO for a página de chat */}
      {!isChatPage && (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsOpen(true)}
          className="fixed bottom-4 right-4 h-12 w-12 rounded-full shadow-lg bg-primary text-primary-foreground hover:bg-primary/90 z-50" // Adicionei z-50 por garantia
          aria-label="Ajuda"
        >
          <HelpCircle className="w-6 h-6" />
        </Button>
      )}

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Guia de Uso do Crm</DialogTitle>
          </DialogHeader>

          <Tabs defaultValue="shortcuts" className="mt-4">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="shortcuts">
                <Keyboard className="w-4 h-4 mr-2" />
                Atalhos
              </TabsTrigger>
              <TabsTrigger value="kanban">
                <MousePointer className="w-4 h-4 mr-2" />
                Kanban
              </TabsTrigger>
              <TabsTrigger value="tips">
                <Palette className="w-4 h-4 mr-2" />
                Dicas
              </TabsTrigger>
            </TabsList>

            <TabsContent value="shortcuts" className="space-y-4 mt-4">
              <div>
                <h3 className="font-semibold mb-3">Atalhos de Teclado</h3>
                <div className="space-y-2">
                  <ShortcutRow keys={["Ctrl", "K"]} description="Busca global" />
                  <ShortcutRow keys={["/"]} description="Focar campo de busca" />
                  <ShortcutRow keys={["N"]} description="Criar novo lead" />
                  <ShortcutRow keys={["M"]} description="Mover lead (no Kanban)" />
                  <ShortcutRow keys={["?"]} description="Abrir esta ajuda" />
                  <ShortcutRow keys={["Esc"]} description="Fechar modal/drawer" />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="kanban" className="space-y-4 mt-4">
              <div>
                <h3 className="font-semibold mb-3">Como Usar o Kanban</h3>
                <div className="space-y-3 text-sm">
                  <Feature
                    icon={<MousePointer className="w-4 h-4" />}
                    title="Drag & Drop"
                    description="Clique e arraste os cards para mover leads entre as colunas."
                  />
                  <Feature
                    icon={<Keyboard className="w-4 h-4" />}
                    title="Navegação por Teclado"
                    description="Use Tab para focar em um card, depois pressione M para abrir o seletor de colunas."
                  />
                  <Feature
                    icon={<Palette className="w-4 h-4" />}
                    title="Customizar Cores"
                    description="Clique no ícone de paleta no cabeçalho da coluna para escolher uma nova cor."
                  />
                  <Feature
                    icon={<HelpCircle className="w-4 h-4" />}
                    title="Detalhes do Lead"
                    description="Clique em um card para abrir o drawer com todas as informações e ações rápidas."
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="tips" className="space-y-4 mt-4">
              <div>
                <h3 className="font-semibold mb-3">Dicas e Recursos</h3>
                <div className="space-y-3 text-sm">
                  <Feature
                    icon={<Download className="w-4 h-4" />}
                    title="Export CSV"
                    description="Na página Leads, exporte os dados filtrados para CSV. A busca é aplicada ao export."
                  />
                  <Feature
                    icon={<Palette className="w-4 h-4" />}
                    title="Tema Dark/Light"
                    description="Use o botão de tema no topo para alternar entre modo escuro e claro. Sua preferência é salva."
                  />
                  <Feature
                    icon={<HelpCircle className="w-4 h-4" />}
                    title="Desfazer Ações"
                    description="Ao deletar ou mover leads para Perdido/Fechado, você tem 5 segundos para desfazer a ação."
                  />
                  <Feature
                    icon={<MousePointer className="w-4 h-4" />}
                    title="Filtros de Período"
                    description="No Dashboard, use os filtros de período para analisar métricas específicas."
                  />
                </div>
              </div>

              <div className="mt-4 p-4 bg-muted rounded-lg">
                <p className="text-sm font-medium mb-1">💡 Você sabia?</p>
                <p className="text-xs text-muted-foreground">
                  Este protótipo está preparado para integração futura com Supabase, permitindo
                  autenticação real, banco de dados e APIs.
                </p>
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ShortcutRow({ keys, description }: { keys: string[]; description: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border">
      <span className="text-sm">{description}</span>
      <div className="flex gap-1">
        {keys.map((key, i) => (
          <kbd key={i} className="px-2 py-1 bg-muted rounded text-xs font-mono">
            {key}
          </kbd>
        ))}
      </div>
    </div>
  );
}

function Feature({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
        {icon}
      </div>
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
    </div>
  );
}