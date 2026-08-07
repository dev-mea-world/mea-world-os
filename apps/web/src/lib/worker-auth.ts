import { randomUUID } from "node:crypto";
import { StoreError } from "@meaworld/db";
import { verifyWorkerSignature } from "@meaworld/security";
import type { NextRequest } from "next/server";
import { getStore } from "./db";
import { getWebEnv } from "./env";

export interface AuthenticatedWorkerRequest {
  workerId: string;
  correlationId: string;
}

export async function authenticateWorkerRequest(
  request: NextRequest,
  rawBody: string,
  requireRegistered: boolean
): Promise<AuthenticatedWorkerRequest> {
  const workerId = request.headers.get("x-worker-id") ?? "";
  const timestamp = request.headers.get("x-worker-timestamp") ?? "";
  const nonce = request.headers.get("x-worker-nonce") ?? "";
  const signature = request.headers.get("x-worker-signature") ?? "";
  const configured = getWebEnv();

  if (workerId !== configured.WORKER_ID) {
    throw new WorkerAuthError("unknown_worker", 401);
  }
  if (!/^[0-9a-f-]{36}$/i.test(nonce)) {
    throw new WorkerAuthError("invalid_nonce", 401);
  }

  const verification = verifyWorkerSignature({
    secret: configured.WORKER_SECRET,
    method: request.method,
    pathname: request.nextUrl.pathname,
    timestamp,
    nonce,
    body: rawBody,
    signature
  });
  if (!verification.ok) {
    throw new WorkerAuthError(verification.reason, 401);
  }

  try {
    await getStore().consumeWorkerNonce(workerId, nonce, requireRegistered);
  } catch (error) {
    if (error instanceof StoreError) {
      throw new WorkerAuthError(error.code, error.status);
    }
    throw error;
  }

  const candidateCorrelationId = request.headers.get("x-correlation-id") ?? "";
  return {
    workerId,
    correlationId: /^[0-9a-f-]{36}$/i.test(candidateCorrelationId)
      ? candidateCorrelationId
      : randomUUID()
  };
}

export class WorkerAuthError extends Error {
  constructor(public readonly code: string, public readonly status: number) {
    super(code);
    this.name = "WorkerAuthError";
  }
}
