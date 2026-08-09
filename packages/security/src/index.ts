import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual
} from "node:crypto";

export const SESSION_COOKIE_NAME = "meaworld_session";
export const WORKER_SIGNATURE_VERSION = "v1";

function equalBuffers(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

export function constantTimeEqualText(actual: string, expected: string): boolean {
  const actualDigest = createHash("sha256").update(actual, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return equalBuffers(actualDigest, expectedDigest);
}

export function createOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function fingerprint(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value, "utf8").digest("hex");
}

export function assertStrongSecret(name: string, secret: string): void {
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error(`${name} must contain at least 32 bytes`);
  }
}

export interface WorkerSignatureInput {
  secret: string;
  method: string;
  pathname: string;
  timestamp: string;
  nonce: string;
  body: string;
}

export function bodyDigest(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

export function workerSignature(input: WorkerSignatureInput): string {
  const canonical = [
    WORKER_SIGNATURE_VERSION,
    input.method.toUpperCase(),
    input.pathname,
    input.timestamp,
    input.nonce,
    bodyDigest(input.body)
  ].join("\n");

  return createHmac("sha256", input.secret).update(canonical, "utf8").digest("hex");
}

export interface VerifyWorkerSignatureInput extends WorkerSignatureInput {
  signature: string;
  now?: Date;
  maxClockSkewMs?: number;
}

export type WorkerSignatureVerification =
  | { ok: true }
  | { ok: false; reason: "invalid_timestamp" | "stale_timestamp" | "invalid_signature" };

export function verifyWorkerSignature(input: VerifyWorkerSignatureInput): WorkerSignatureVerification {
  const timestampMs = Date.parse(input.timestamp);
  if (!Number.isFinite(timestampMs)) {
    return { ok: false, reason: "invalid_timestamp" };
  }

  const nowMs = (input.now ?? new Date()).getTime();
  const maxClockSkewMs = input.maxClockSkewMs ?? 5 * 60_000;
  if (Math.abs(nowMs - timestampMs) > maxClockSkewMs) {
    return { ok: false, reason: "stale_timestamp" };
  }

  const expected = Buffer.from(workerSignature(input), "hex");
  const actual = Buffer.from(input.signature, "hex");
  return equalBuffers(actual, expected)
    ? { ok: true }
    : { ok: false, reason: "invalid_signature" };
}

export function isAllowedOrigin(requestUrl: string, origin: string | null, publicAppUrl: string): boolean {
  if (!origin) {
    return false;
  }

  try {
    new URL(requestUrl);
    const configuredOrigin = new URL(publicAppUrl).origin;
    return origin === configuredOrigin;
  } catch {
    return false;
  }
}

export function redactSecrets(value: unknown, secretNames = [
  "password",
  "accessCode",
  "sessionToken",
  "workerSecret",
  "notionToken",
  "telegramBotToken",
  "botToken",
  "telegramWebhookSecret",
  "telegramPairingCode",
  "authorization",
  "cookie"
]): unknown {
  const blocked = new Set(secretNames.map((name) => name.toLowerCase()));

  const visit = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) {
      return candidate.map(visit);
    }

    if (candidate && typeof candidate === "object") {
      return Object.fromEntries(
        Object.entries(candidate).map(([key, child]) => [
          key,
          blocked.has(key.toLowerCase()) ? "[REDACTED]" : visit(child)
        ])
      );
    }

    return candidate;
  };

  return visit(value);
}
