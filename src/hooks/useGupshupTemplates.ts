import { useCallback, useEffect, useRef, useState } from "react";

import { isPendingGupshupTemplate } from "@/lib/gupshupTemplates";
import {
  createGupshupTemplate,
  listGupshupTemplates,
  type CreateGupshupTemplateInput,
  type GupshupTemplate,
} from "@/services/gupshupTemplateService";

export function useGupshupTemplates(instanceName: string, enabled: boolean) {
  const [templates, setTemplates] = useState<GupshupTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const loadTemplates = useCallback(async () => {
    const normalizedInstanceName = instanceName.trim();
    if (!enabled || !normalizedInstanceName) {
      setTemplates([]);
      setError(null);
      return;
    }

    const requestId = ++requestSequence.current;
    setLoading(true);
    setError(null);

    try {
      const response = await listGupshupTemplates(normalizedInstanceName);
      if (requestId === requestSequence.current) {
        setTemplates(response.templates ?? []);
      }
    } catch (requestError) {
      if (requestId === requestSequence.current) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Nao foi possivel carregar os templates",
        );
      }
    } finally {
      if (requestId === requestSequence.current) {
        setLoading(false);
      }
    }
  }, [enabled, instanceName]);

  useEffect(() => {
    void loadTemplates();
    return () => {
      requestSequence.current += 1;
    };
  }, [loadTemplates]);

  useEffect(() => {
    if (
      !enabled ||
      !templates.some((template) => isPendingGupshupTemplate(template.status))
    ) {
      return undefined;
    }

    const pollingTimer = window.setInterval(() => void loadTemplates(), 30_000);
    return () => window.clearInterval(pollingTimer);
  }, [enabled, loadTemplates, templates]);

  const submitTemplate = useCallback(
    async (input: CreateGupshupTemplateInput) => {
      setCreating(true);
      setError(null);

      try {
        const response = await createGupshupTemplate(input);
        setTemplates((current) => {
          const withoutCreatedTemplate = current.filter(
            (template) =>
              template.id !== response.template.id &&
              template.name !== response.template.name,
          );
          return [response.template, ...withoutCreatedTemplate];
        });
        return response.template;
      } catch (createError) {
        const message =
          createError instanceof Error
            ? createError.message
            : "Nao foi possivel criar o template";
        setError(message);
        throw createError;
      } finally {
        setCreating(false);
      }
    },
    [],
  );

  return {
    templates,
    loading,
    creating,
    error,
    refetch: loadTemplates,
    createTemplate: submitTemplate,
  };
}
