export type PipelineWorkerEnvironment = {
  nodeEnv?: string;
  pipelineWorkerEnabled?: string;
};

export function requirePipelineWorkerEnabled(
  environment: PipelineWorkerEnvironment,
): boolean {
  if (
    environment.nodeEnv === "production" &&
    environment.pipelineWorkerEnabled !== "true"
  ) {
    throw new Error(
      "PIPELINE_WORKER_ENABLED=true e obrigatorio em producao",
    );
  }

  return environment.pipelineWorkerEnabled === "true";
}

export function startPipelineWorkerIfEnabled(
  enabled: boolean,
  startWorker: () => () => void,
): (() => void) | null {
  return enabled ? startWorker() : null;
}

export class PipelineWorkerRuntimeStatus {
  private started = false;
  private lastCycleAt: string | null = null;

  constructor(private readonly enabled: boolean) {}

  markStarted() {
    this.started = true;
  }

  markCycleStarted(at: Date = new Date()) {
    this.lastCycleAt = at.toISOString();
  }

  markStopped() {
    this.started = false;
  }

  getStatus() {
    return {
      enabled: this.enabled,
      started: this.started,
      lastCycleAt: this.lastCycleAt,
    };
  }
}

export const pipelineWorkerRuntimeStatus = new PipelineWorkerRuntimeStatus(
  process.env.PIPELINE_WORKER_ENABLED === "true",
);
