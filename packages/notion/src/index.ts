import { createHash } from "node:crypto";
import { Client } from "@notionhq/client";

export interface NotionInventoryObject {
  externalId: string;
  objectType: string;
  url: string | null;
  lastEditedAt: string | null;
  contentHash: string;
  metadata: Record<string, unknown>;
}

export interface NotionSample {
  objects: NotionInventoryObject[];
  truncated: boolean;
  nextCursor: string | null;
}

interface NotionSearchResult {
  id: string;
  object?: string;
  url?: string;
  last_edited_time?: string;
}

export interface NotionSearchClient {
  search(input: { page_size: number }): Promise<{
    results: NotionSearchResult[];
    has_more: boolean;
    next_cursor: string | null;
  }>;
}

function stringProperty(value: unknown, property: string): string | null {
  if (value && typeof value === "object" && property in value) {
    const candidate = (value as Record<string, unknown>)[property];
    return typeof candidate === "string" ? candidate : null;
  }
  return null;
}

export async function sampleNotionInventory(
  token: string,
  limit: number,
  clientOverride?: NotionSearchClient
): Promise<NotionSample> {
  if (!token) throw new Error("NOTION_TOKEN is required");
  const boundedLimit = Math.max(1, Math.min(limit, 20));
  const client = clientOverride ?? new Client({ auth: token }) as unknown as NotionSearchClient;
  const response = await client.search({ page_size: boundedLimit });

  const objects = response.results.map((result) => {
    const objectType = stringProperty(result, "object") ?? "unknown";
    const url = stringProperty(result, "url");
    const lastEditedAt = stringProperty(result, "last_edited_time");
    const stableMaterial = JSON.stringify({
      id: result.id,
      objectType,
      url,
      lastEditedAt
    });
    return {
      externalId: result.id,
      objectType,
      url,
      lastEditedAt,
      contentHash: createHash("sha256").update(stableMaterial, "utf8").digest("hex"),
      metadata: { sampleOnly: true }
    };
  });

  return {
    objects,
    truncated: response.has_more,
    nextCursor: response.next_cursor ?? null
  };
}
