import { getCrmBackend, postCrmBackend } from "@/services/crmBackend";
import type { SimulatorAccount, SimulatorAgent, SimulatorAttachment, SimulatorMessage, SimulatorTest, SimulatorTool, SimulatorToolEvent } from "@/types/agentSimulator";

type AgentConfigResponse = { agent: SimulatorAgent; tools: SimulatorTool[] };
type TurnResponse = {
  replyBlocks: string[];
  confidence: number;
  toolEvents: SimulatorToolEvent[];
  activeTools: SimulatorTool[];
};

export async function listSimulatorAccounts() {
  const response = await getCrmBackend<{ accounts: SimulatorAccount[] }>("/api/agent-simulator/accounts");
  return response.accounts ?? [];
}

export async function listSimulatorAgents(acesId: number) {
  const response = await getCrmBackend<{ agents: SimulatorAgent[] }>(`/api/agent-simulator/accounts/${acesId}/agents`);
  return response.agents ?? [];
}

export function getSimulatorAgentConfig(acesId: number, agentId: string) {
  return getCrmBackend<AgentConfigResponse>(`/api/agent-simulator/accounts/${acesId}/agents/${agentId}`);
}

export async function simulateAgentTurn(input: {
  acesId: number;
  agentId: string;
  scenarioKey: string | null;
  messages: SimulatorMessage[];
  attachments: SimulatorAttachment[];
}) {
  const response = await postCrmBackend<TurnResponse>(
    `/api/agent-simulator/accounts/${input.acesId}/agents/${input.agentId}/turns`,
    {
      scenarioKey: input.scenarioKey,
      messages: input.messages.map(({ role, content }) => ({ role, content })),
      attachments: input.attachments,
    },
  );
  return response;
}

export function sendSimulatorReport(input: {
  clientReportId: string;
  accountName: string;
  targetAcesId: number;
  agentName: string;
  tests: SimulatorTest[];
  generalNote: string;
}) {
  return postCrmBackend<{ success: boolean; conversationId: string }>("/api/agent-simulator/reports", {
    ...input,
    tests: input.tests
      .filter((test) => test.status !== "not_tested")
      .map(({ kind, name, status, note }) => ({ kind, name, status, note: note.trim() || undefined })),
  });
}
