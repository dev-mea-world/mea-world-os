import { createHash } from "node:crypto";

export interface ProposalHashInput {
  target: string;
  operation: string;
  beforeSnapshot: Record<string, unknown>;
  afterSnapshot: Record<string, unknown>;
  reason: string;
  evidence: Array<Record<string, unknown>>;
  risk: "low" | "medium" | "high";
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)])
    );
  }

  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function computeProposalHash(input: ProposalHashInput): string {
  return createHash("sha256").update(canonicalJson(input), "utf8").digest("hex");
}

export function proposalMaterial(input: ProposalHashInput): ProposalHashInput {
  return {
    target: input.target,
    operation: input.operation,
    beforeSnapshot: input.beforeSnapshot,
    afterSnapshot: input.afterSnapshot,
    reason: input.reason,
    evidence: input.evidence,
    risk: input.risk
  };
}
