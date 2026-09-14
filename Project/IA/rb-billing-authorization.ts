import { HttpError } from "./sdr-agent-gemini.js";

type RbBillingAuthContext = {
  role: string;
};

export function requireRbBillingAdmin<T extends RbBillingAuthContext>(context: T): T {
  if (context.role !== "ADMIN") {
    throw new HttpError(403, "Apenas administradores podem executar cobrancas manualmente");
  }

  return context;
}
