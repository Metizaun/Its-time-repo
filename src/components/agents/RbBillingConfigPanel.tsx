import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Wallet, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listAgentTools, updateAgentTool, type AgentTool } from "@/services/agentToolsService";

type Props = {
  agentId: string;
  onClose: () => void;
  onChanged: () => void;
};

const labelClass =
  "font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--color-gray-600)]";
const inputClass =
  "h-10 w-full rounded-[var(--radius-md)] border border-[var(--border-input)] bg-[var(--color-surface-1)] px-3 text-sm shadow-inset outline-none transition-shadow focus:shadow-focus";
const RB_DEFAULT_BASE_URL = "https://app.registrobase.com.br:32077";
const RB_DEFAULT_TRIGGER_TIME = "10:00";
const RB_DEFAULT_TIMEZONE = "America/Sao_Paulo";

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown) {
  return typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
}

function parseCompanyIds(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .join(", ");
  }

  return asString(value);
}

function parseCompanyIdsInput(value: string) {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePixMapping(value: unknown) {
  const mapping = asRecord(value);
  return Object.fromEntries(
    Object.entries(mapping)
      .map(([key, item]) => [key, asString(item).trim()])
      .filter(([, item]) => item.length > 0),
  );
}

function readinessLabel(readiness: AgentTool["readiness"]) {
  if (readiness === "ready") {
    return "Pronta";
  }

  if (readiness === "unavailable") {
    return "Indisponivel";
  }

  return "Pendente";
}

export function RbBillingConfigPanel({ agentId, onClose, onChanged }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tool, setTool] = useState<AgentTool | null>(null);
  const [integrationEnabled, setIntegrationEnabled] = useState(false);
  const [tokenApi, setTokenApi] = useState("");
  const [empresaIdsText, setEmpresaIdsText] = useState("");
  const [pixMappingByStore, setPixMappingByStore] = useState<Record<string, string>>({});

  const loadTool = useCallback(async () => {
    setLoading(true);
    try {
      const items = await listAgentTools(agentId);
      const currentTool = items.find((item) => item.key === "rb_billing") ?? null;
      setTool(currentTool);

      const config = asRecord(currentTool?.config);
      setIntegrationEnabled(Boolean(currentTool?.enabled));
      setTokenApi(asString(config.rb_token_api));
      setEmpresaIdsText(parseCompanyIds(config.rb_empresa_ids));
      setPixMappingByStore(parsePixMapping(config.pix_mapping_by_store));
    } catch (error) {
      toast.error("Nao foi possivel carregar a configuracao RB", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void loadTool();
  }, [loadTool]);

  const companyIds = useMemo(() => parseCompanyIdsInput(empresaIdsText), [empresaIdsText]);

  async function saveConfig() {
    try {
      setSaving(true);

      const nextPixMapping = Object.fromEntries(
        companyIds
          .map((companyId) => [companyId, (pixMappingByStore[companyId] ?? "").trim()] as const)
          .filter(([, pix]) => pix.length > 0),
      );
      const currentConfig = asRecord(tool?.config);
      const hasLiveCredentials = tokenApi.trim().length > 0 || companyIds.length > 0;

      const updated = await updateAgentTool(agentId, "rb_billing", {
        isEnabled: integrationEnabled,
        config: {
          rb_mode: hasLiveCredentials ? "live" : asString(currentConfig.rb_mode) || "live",
          rb_base_url: asString(currentConfig.rb_base_url) || RB_DEFAULT_BASE_URL,
          rb_token_api: tokenApi.trim(),
          rb_empresa_ids: companyIds,
          trigger_time: asString(currentConfig.trigger_time) || RB_DEFAULT_TRIGGER_TIME,
          timezone: asString(currentConfig.timezone) || RB_DEFAULT_TIMEZONE,
          pix_mapping_by_store: nextPixMapping,
        },
      });

      setTool(updated ?? null);
      toast.success("Configuracao RB salva");
      onChanged();
      await loadTool();
    } catch (error) {
      toast.error("Nao foi possivel salvar a configuracao RB", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="grid min-h-28 place-items-center rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--color-bg-subtle)]">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 max-w-full overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-primary-200)] bg-[var(--color-bg-subtle)] p-4 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0 flex gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-[var(--color-primary-50)] text-[var(--color-primary-600)]">
            <Wallet className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-[var(--color-gray-900)]">Cobranca RB</p>
            <p className="text-xs text-[var(--color-gray-600)]">
              Configure a conexao com o Registro Base. As mensagens e estagios ficam na automacao.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-2 hover:bg-[var(--color-bg-muted)]"
          aria-label="Fechar"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1.5 md:col-span-2">
          <span className={labelClass}>Token API</span>
          <Input
            className={inputClass}
            value={tokenApi}
            onChange={(event) => setTokenApi(event.target.value)}
            placeholder="Cole o token do Registro Base"
          />
        </label>

        <label className="space-y-1.5 md:col-span-2">
          <span className={labelClass}>Empresa IDs</span>
          <Input
            className={inputClass}
            value={empresaIdsText}
            onChange={(event) => setEmpresaIdsText(event.target.value)}
            placeholder="1,2"
          />
        </label>
      </div>

      <div className="mt-5 rounded-[20px] border border-[var(--border-default)] bg-[var(--color-surface-1)] p-4">
        <div className="mb-3">
          <Label className={labelClass}>Pix por loja</Label>
          <p className="mt-1 text-xs text-[var(--color-gray-600)]">
            O Pix e vinculado por empresa. Edite apenas as lojas informadas em Empresa IDs.
          </p>
        </div>

        {companyIds.length === 0 ? (
          <div className="rounded-[16px] border border-dashed border-[var(--border-default)] bg-[var(--color-surface-2)] px-4 py-5 text-sm text-[var(--color-gray-600)]">
            Informe os IDs das empresas para liberar a tabela de Pix por loja.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-[16px] border border-[var(--border-default)]">
            <div className="min-w-[340px]">
              <div className="grid grid-cols-[88px_minmax(0,1fr)] bg-[var(--color-surface-2)] px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-gray-600)] sm:grid-cols-[120px_minmax(0,1fr)]">
                <span>ID</span>
                <span>Pix</span>
              </div>
              <div className="divide-y divide-[var(--border-default)]">
                {companyIds.map((companyId) => (
                  <div
                    key={companyId}
                    className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-3 px-4 py-3 sm:grid-cols-[120px_minmax(0,1fr)]"
                  >
                    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--color-surface-2)] px-3 py-2 text-sm font-medium text-[var(--color-gray-800)]">
                      {companyId}
                    </div>
                    <Input
                      className={inputClass}
                      value={pixMappingByStore[companyId] ?? ""}
                      onChange={(event) =>
                        setPixMappingByStore((previous) => ({
                          ...previous,
                          [companyId]: event.target.value,
                        }))
                      }
                      placeholder="Chave Pix da loja"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={saving}>
          Fechar
        </Button>
        <Button onClick={saveConfig} disabled={saving}>
          {saving ? "Salvando..." : "Salvar configuracao"}
        </Button>
      </div>
    </div>
  );
}
