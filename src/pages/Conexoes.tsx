import { useQuery } from "@tanstack/react-query";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";

import { useAuth } from "@/contexts/AuthContext";
import { InstanceManager } from "@/components/admin/InstanceManager";
import type { ConnectionStatus } from "@/components/connections/ConnectionCard";
import { getCollectionConfiguration, listCollectionSources } from "@/services/collectionsService";

export default function Conexoes() {
  const { userRole } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
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

  return (
    <div className="connections-page">
      <InstanceManager
        billingStatus={billingStatus}
        billingStatusLabel={billingStatusLabel}
        onOpenBilling={() => navigate(returnToBilling && billingSourceId
          ? `/cobranca?source=${encodeURIComponent(billingSourceId)}`
          : "/cobranca")}
      />
    </div>
  );
}
