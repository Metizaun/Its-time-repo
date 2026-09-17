import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";

import { useAuth } from "@/contexts/AuthContext";
import { InstanceManager } from "@/components/admin/InstanceManager";
import { LeadWebhookConnections } from "@/components/connections/LeadWebhookConnections";
import { WebsiteWidgetConnections } from "@/components/connections/WebsiteWidgetConnections";
import type { ConnectionStatus } from "@/components/connections/ConnectionCard";
import { getCollectionConfiguration, listCollectionSources } from "@/services/collectionsService";
import { listLeadWebhookConnections } from "@/services/leadWebhookService";
import { listWebsiteWidgetConnections } from "@/services/websiteWidgetService";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export default function Conexoes() {
  const { userRole } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [connectionPanel, setConnectionPanel] = useState<"leads" | "website" | null>(null);
  const returnToBilling = searchParams.get("returnTo") === "cobranca";
  const billingSourceId = searchParams.get("source");
  const collectionSources = useQuery({
    queryKey: ["collection-sources"],
    queryFn: listCollectionSources,
    enabled: userRole === "ADMIN",
  });
  const collectionConfiguration = useQuery({
    queryKey: ["collection-config"],
    queryFn: getCollectionConfiguration,
    enabled: userRole === "ADMIN",
  });
  const leadWebhookConnections = useQuery({
    queryKey: ["lead-webhook-connections"],
    queryFn: listLeadWebhookConnections,
    enabled: userRole === "ADMIN",
  });
  const websiteWidgetConnections = useQuery({
    queryKey: ["website-widget-connections"],
    queryFn: listWebsiteWidgetConnections,
    enabled: userRole === "ADMIN",
  });

  if (userRole !== "ADMIN") {
    return <Navigate to="/" replace />;
  }

  if (searchParams.get("connection") === "cobranca") {
    return <Navigate to="/cobranca" replace />;
  }

  const billingStatus: ConnectionStatus = collectionSources.isLoading || collectionConfiguration.isLoading
    ? "pending"
    : collectionSources.isError || collectionConfiguration.isError
      ? "attention"
      : !collectionSources.data?.length
        ? "not_configured"
        : collectionConfiguration.data?.onboarding?.some((item) => item.sendingEnabled)
          ? "connected"
          : "pending";
  const billingStatusLabel = collectionSources.isLoading || collectionConfiguration.isLoading
    ? "Verificando"
    : collectionSources.isError || collectionConfiguration.isError
      ? "Atenção necessária"
      : !collectionSources.data?.length
        ? "Não configurada"
        : collectionConfiguration.data?.onboarding?.some((item) => item.sendingEnabled)
          ? "Envios ativos"
          : "Configuração pendente";

  const leadWebhookStatus: ConnectionStatus = leadWebhookConnections.isLoading
    ? "pending"
    : leadWebhookConnections.isError
      ? "attention"
      : leadWebhookConnections.data?.length
        ? "connected"
        : "not_configured";
  const leadWebhookStatusLabel = leadWebhookConnections.isLoading
    ? "Verificando"
    : leadWebhookConnections.isError
      ? "Atenção necessária"
      : leadWebhookConnections.data?.length
        ? `${leadWebhookConnections.data.length} configurada${leadWebhookConnections.data.length === 1 ? "" : "s"}`
        : "Não configurada";

  const websiteWidgetStatus: ConnectionStatus = websiteWidgetConnections.isLoading
    ? "pending"
    : websiteWidgetConnections.isError
      ? "attention"
      : websiteWidgetConnections.data?.length
        ? "connected"
        : "not_configured";
  const websiteWidgetStatusLabel = websiteWidgetConnections.isLoading
    ? "Verificando"
    : websiteWidgetConnections.isError
      ? "Atenção necessária"
      : websiteWidgetConnections.data?.length
        ? `${websiteWidgetConnections.data.length} configurado${websiteWidgetConnections.data.length === 1 ? "" : "s"}`
        : "Não configurado";

  return (
    <div className="connections-page">
      <InstanceManager
        billingStatus={billingStatus}
        billingStatusLabel={billingStatusLabel}
        leadWebhookConnection={{
          status: leadWebhookStatus,
          statusLabel: leadWebhookStatusLabel,
          actionLabel: leadWebhookConnections.data?.length ? "Gerenciar" : "Criar conexão",
          onAction: () => setConnectionPanel("leads"),
        }}
        websiteWidgetConnection={{
          status: websiteWidgetStatus,
          statusLabel: websiteWidgetStatusLabel,
          actionLabel: websiteWidgetConnections.data?.length ? "Gerenciar" : "Criar conexão",
          onAction: () => setConnectionPanel("website"),
          instanceNames: websiteWidgetConnections.data?.map((connection) => connection.instanceName) ?? [],
          activeCount: websiteWidgetConnections.data?.filter((connection) => connection.status === "active").length ?? 0,
          loaded: !websiteWidgetConnections.isLoading && !websiteWidgetConnections.isError,
        }}
        onOpenBilling={() => navigate(returnToBilling && billingSourceId
          ? `/cobranca?source=${encodeURIComponent(billingSourceId)}`
          : "/cobranca")}
      />
      <Sheet
        open={connectionPanel !== null}
        onOpenChange={(open) => {
          if (!open) setConnectionPanel(null);
        }}
      >
        <SheetContent side="right" className="connection-accounts-sheet sm:max-w-3xl">
          <SheetHeader className="sr-only">
            <SheetTitle>
              {connectionPanel === "leads" ? "Entrada de leads" : "Agente no site"}
            </SheetTitle>
            <SheetDescription>
              Gerencie as conexões desta integração.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {connectionPanel === "leads" ? (
              <LeadWebhookConnections
                mode="panel"
                createOnMount={!leadWebhookConnections.data?.length}
              />
            ) : connectionPanel === "website" ? (
              <WebsiteWidgetConnections
                mode="panel"
                createOnMount={!websiteWidgetConnections.data?.length}
              />
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
