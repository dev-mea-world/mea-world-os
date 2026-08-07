import { randomUUID } from "node:crypto";
import type {
  GitPublicationCommand,
  GitPublicationRecord,
  HeartbeatPayload,
  LeasedWork,
  RunComplete,
  RunRecord,
  WorkerRecord
} from "@meaworld/domain";
import { workerSignature } from "@meaworld/security";

export class WorkerApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string
  ) {
    super(`Worker API returned ${status}: ${code}`);
    this.name = "WorkerApiError";
  }
}

export class WorkerApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly workerId: string,
    private readonly secret: string
  ) {}

  private async post<Result>(
    pathname: string,
    payload: unknown,
    correlationId: string = randomUUID()
  ): Promise<Result> {
    const body = JSON.stringify(payload);
    const timestamp = new Date().toISOString();
    const nonce = randomUUID();
    const signature = workerSignature({
      secret: this.secret,
      method: "POST",
      pathname,
      timestamp,
      nonce,
      body
    });
    const response = await fetch(new URL(pathname, this.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-worker-id": this.workerId,
        "x-worker-timestamp": timestamp,
        "x-worker-nonce": nonce,
        "x-worker-signature": signature,
        "x-correlation-id": correlationId
      },
      body,
      signal: AbortSignal.timeout(20_000)
    });
    const result = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      throw new WorkerApiError(response.status, typeof result.error === "string" ? result.error : "unknown_error");
    }
    return result as Result;
  }

  heartbeat(payload: HeartbeatPayload): Promise<{ worker: WorkerRecord }> {
    return this.post("/api/workers/heartbeat", payload);
  }

  lease(leaseSeconds: number): Promise<{ work: LeasedWork | null }> {
    return this.post("/api/tasks/lease", { leaseSeconds });
  }

  startRun(runId: string, leaseToken: string, correlationId?: string): Promise<{ run: RunRecord }> {
    return this.post(`/api/runs/${runId}/start`, { leaseToken }, correlationId);
  }

  checkpoint(
    runId: string,
    leaseToken: string,
    checkpoint: Record<string, unknown>,
    correlationId?: string
  ): Promise<{ sequence: number }> {
    return this.post(`/api/runs/${runId}/checkpoint`, { leaseToken, checkpoint }, correlationId);
  }

  renewLease(
    runId: string,
    leaseToken: string,
    leaseSeconds: number,
    correlationId?: string
  ): Promise<{ leaseExpiresAt: string }> {
    return this.post(`/api/runs/${runId}/renew`, { leaseToken, leaseSeconds }, correlationId);
  }

  completeRun(runId: string, completion: RunComplete, correlationId?: string): Promise<unknown> {
    return this.post(`/api/runs/${runId}/complete`, completion, correlationId);
  }

  recordGitPublication(
    runId: string,
    command: GitPublicationCommand,
    correlationId?: string
  ): Promise<{ publication: GitPublicationRecord | null }> {
    return this.post(`/api/runs/${runId}/git-publication`, command, correlationId);
  }

  recordNotionSample(payload: unknown): Promise<{ runId: string }> {
    return this.post("/api/notion/sample", payload);
  }
}
