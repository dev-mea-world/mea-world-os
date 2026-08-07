import { describe, expect, it } from "vitest";
import { canonicalJson, computeProposalHash } from "@meaworld/approvals";
import {
  createOpaqueToken,
  hashOpaqueToken,
  isAllowedOrigin,
  redactSecrets,
  verifyWorkerSignature,
  workerSignature
} from "@meaworld/security";

describe("Phase 0 security primitives", () => {
  it("signs the exact worker request and rejects tampering or stale timestamps", () => {
    const input = {
      secret: "s".repeat(32),
      method: "POST",
      pathname: "/api/workers/heartbeat",
      timestamp: "2026-08-07T12:00:00.000Z",
      nonce: "074cbe4a-4eca-4de6-99f2-f3a595cf8054",
      body: '{"workerId":"mac-mini"}'
    };
    const signature = workerSignature(input);

    expect(verifyWorkerSignature({ ...input, signature, now: new Date(input.timestamp) })).toEqual({ ok: true });
    expect(verifyWorkerSignature({ ...input, body: "{}", signature, now: new Date(input.timestamp) })).toEqual({
      ok: false,
      reason: "invalid_signature"
    });
    expect(verifyWorkerSignature({ ...input, signature, now: new Date("2026-08-07T12:06:00.000Z") })).toEqual({
      ok: false,
      reason: "stale_timestamp"
    });
  });

  it("stores only an irreversible session-token hash", () => {
    const token = createOpaqueToken();
    const hash = hashOpaqueToken(token);
    expect(token).not.toBe(hash);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("canonicalizes proposal material before hashing", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    const first = computeProposalHash({
      target: "phase0://demo",
      operation: "NOOP",
      beforeSnapshot: { b: 2, a: 1 },
      afterSnapshot: { ready: true },
      reason: "test",
      evidence: [{ source: "seed", line: 1 }],
      risk: "low"
    });
    const second = computeProposalHash({
      target: "phase0://demo",
      operation: "NOOP",
      beforeSnapshot: { a: 1, b: 2 },
      afterSnapshot: { ready: true },
      reason: "test",
      evidence: [{ line: 1, source: "seed" }],
      risk: "low"
    });
    expect(first).toBe(second);
  });

  it("requires a same-origin protected mutation and redacts named secrets", () => {
    expect(isAllowedOrigin("https://os.example/api/x", "https://os.example", "https://os.example")).toBe(true);
    expect(isAllowedOrigin("https://os.example/api/x", "https://evil.example", "https://os.example")).toBe(false);
    expect(redactSecrets({ workerSecret: "sentinel", nested: { notionToken: "sentinel" } })).toEqual({
      workerSecret: "[REDACTED]",
      nested: { notionToken: "[REDACTED]" }
    });
  });
});
