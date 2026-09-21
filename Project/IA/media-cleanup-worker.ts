import { createClient } from "@supabase/supabase-js";

type MediaCleanupWorkerConfig = {
  supabaseUrl: string;
  serviceRoleKey: string;
  pollMs: number;
  batchSize: number;
};

export function startMediaCleanupWorker(config: MediaCleanupWorkerConfig) {
  const agents = createClient(config.supabaseUrl, config.serviceRoleKey, {
    db: { schema: "agents" },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const { data, error } = await agents
        .from("media_assets")
        .select("id,storage_bucket,storage_path")
        .not("purge_after", "is", null)
        .lte("purge_after", new Date().toISOString())
        .limit(config.batchSize);
      if (error) throw error;

      for (const asset of data ?? []) {
        const { error: storageError } = await agents.storage.from(String(asset.storage_bucket)).remove([String(asset.storage_path)]);
        if (storageError) {
          console.error("[media-cleanup] storage_remove_failed", { assetId: asset.id, error: storageError.message });
          continue;
        }
        const { error: deleteError } = await agents.from("media_assets").delete().eq("id", asset.id);
        if (deleteError) console.error("[media-cleanup] row_delete_failed", { assetId: asset.id, error: deleteError.message });
      }
    } catch (error) {
      console.error("[media-cleanup] run_failed", error);
    } finally {
      running = false;
    }
  };

  void run();
  const interval = setInterval(() => void run(), config.pollMs);
  return { stop: () => clearInterval(interval), run };
}
