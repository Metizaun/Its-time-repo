import { useState } from "react";

import { supabase } from "@/integrations/supabase/client";

import type {
  InstagramInsightsFocus,
  InstagramInsightsResult,
  InstagramScriptImproveResult,
} from "@/features/instagram-analyzer/types";

export function useInstagramInsights() {
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [scriptLoading, setScriptLoading] = useState(false);

  const generateInsights = async (payload: { projectId: string; focus: InstagramInsightsFocus }) => {
    setInsightsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke<InstagramInsightsResult>("instagram-insights", {
        body: payload,
      });

      if (error) {
        throw error;
      }

      if (!data?.analysisDocumentId) {
        throw new Error("Invalid insights response");
      }

      return data;
    } finally {
      setInsightsLoading(false);
    }
  };

  const improveScript = async (payload: { projectId: string; originalScript: string; improvementGoal: string }) => {
    setScriptLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke<InstagramScriptImproveResult>(
        "instagram-script-improve",
        {
          body: payload,
        },
      );

      if (error) {
        throw error;
      }

      if (!data?.improvedScript) {
        throw new Error("Invalid script improvement response");
      }

      return data;
    } finally {
      setScriptLoading(false);
    }
  };

  return {
    insightsLoading,
    scriptLoading,
    generateInsights,
    improveScript,
  };
}

