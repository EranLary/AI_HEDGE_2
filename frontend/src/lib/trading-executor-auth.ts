import "server-only";

import { loadExecutorCredential, registerExecutorNonce } from "@/lib/trading-db";
import {
  matchesSha256,
  readExecutorAuthHeaders,
  verifyExecutorSignature,
} from "@/lib/trading-security";

export class ExecutorAuthenticationError extends Error {
  constructor(message = "Executor authentication failed.") {
    super(message);
    this.name = "ExecutorAuthenticationError";
  }
}

export async function authenticateExecutorRequest<T>(request: Request): Promise<{
  connectionId: string;
  body: T;
  mode: "paper" | "live";
  accountFingerprint: string;
}> {
  const rawBody = await request.text();
  if (rawBody.length > 1_000_000) throw new ExecutorAuthenticationError("Executor request body is too large.");
  const headers = readExecutorAuthHeaders(request);
  if (!verifyExecutorSignature(headers, rawBody)) throw new ExecutorAuthenticationError();
  const credential = await loadExecutorCredential(headers.connectionId);
  if (!credential || !matchesSha256(headers.secret, credential.deviceSecretHash)) {
    throw new ExecutorAuthenticationError();
  }
  if (!(await registerExecutorNonce(headers.connectionId, headers.nonce))) {
    throw new ExecutorAuthenticationError("Executor request was already received.");
  }
  try {
    return {
      connectionId: headers.connectionId,
      body: JSON.parse(rawBody || "{}") as T,
      mode: credential.mode,
      accountFingerprint: credential.accountFingerprint,
    };
  } catch {
    throw new ExecutorAuthenticationError("Executor request body is not valid JSON.");
  }
}
