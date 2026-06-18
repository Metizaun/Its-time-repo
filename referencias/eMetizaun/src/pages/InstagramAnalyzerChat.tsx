import { MessageSquare } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function InstagramAnalyzerChat() {
  return (
    <div className="flex h-full min-h-0 items-center justify-center">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <MessageSquare className="h-5 w-5" />
            Chat de IA (placeholder)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Esta tela foi criada para receber o chat atual dentro do modulo Instagram Analyzer.
          </p>
          <p className="text-sm text-muted-foreground">
            Nesta fase, mantemos apenas a estrutura visual e rotas sem portar a logica de conversa.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

