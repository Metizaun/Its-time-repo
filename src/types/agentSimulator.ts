export type SimulatorAccount = {
  acesId: number;
  name: string;
  status: string;
};

export type SimulatorAgent = {
  id: string;
  name: string;
  instanceName: string | null;
  agentType: "primary" | "subagent";
  model: string;
  isActive: boolean;
};

export type SimulatorTool = {
  id: string;
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  readiness: string;
};

export type SimulatorAttachment = {
  kind: "image" | "audio";
  fileName: string;
  mimeType: string;
  size: number;
};

export type SimulatorMessage = {
  id: string;
  role: "lead" | "agent";
  content: string;
  attachment?: SimulatorAttachment | null;
  toolEvents?: SimulatorToolEvent[];
};

export type SimulatorToolEvent = {
  key: string;
  name: string;
  mode: "read_only" | "simulated";
  status: "available" | "simulated" | "blocked";
  detail: string;
};

export type SimulatorTestStatus = "not_tested" | "passed" | "failed";

export type SimulatorTest = {
  id: string;
  kind: "scenario" | "tool";
  name: string;
  status: SimulatorTestStatus;
  note: string;
};
