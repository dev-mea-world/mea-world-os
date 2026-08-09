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

interface NotionResearchSearchResult {
  id: string;
  object?: string;
  url?: string;
  last_edited_time?: string;
  properties?: Record<string, unknown>;
}

export interface NotionResearchClient {
  search(input: {
    query: string;
    page_size: number;
    filter: { property: "object"; value: "page" };
    sort: { timestamp: "last_edited_time"; direction: "descending" };
  }): Promise<{
    results: NotionResearchSearchResult[];
    has_more: boolean;
    next_cursor: string | null;
    request_status?: { type?: string; incomplete_reason?: string };
  }>;
  retrieveMarkdown(input: { page_id: string; include_transcript: false }): Promise<{
    markdown: string;
    truncated: boolean;
    unknown_block_ids: string[];
  }>;
}

export interface NotionResearchSource {
  reference: string;
  externalId: string;
  title: string;
  url: string | null;
  lastEditedAt: string | null;
  contentHash: string;
  markdown: string;
  matchedQueries: string[];
  partial: boolean;
}

export interface NotionResearchCoverage {
  requestedQueries: string[];
  searchResultCount: number;
  uniquePagesFound: number;
  fetchedPages: number;
  inaccessiblePages: number;
  partial: boolean;
  limits: { maxPages: number; maxCharacters: number };
}

export interface NotionResearchPacket {
  sources: NotionResearchSource[];
  coverage: NotionResearchCoverage;
}

export class NotionResearchError extends Error {
  constructor(public readonly code: string, public readonly retryable: boolean) {
    super(code);
    this.name = "NotionResearchError";
  }
}

function stringProperty(value: unknown, property: string): string | null {
  if (value && typeof value === "object" && property in value) {
    const candidate = (value as Record<string, unknown>)[property];
    return typeof candidate === "string" ? candidate : null;
  }
  return null;
}

function plainText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value.map((item) => stringProperty(item, "plain_text") ?? "").join("").trim();
}

function pageTitle(result: NotionResearchSearchResult): string {
  if (!result.properties) return "Pagina senza titolo";
  for (const property of Object.values(result.properties)) {
    if (!property || typeof property !== "object") continue;
    const candidate = property as Record<string, unknown>;
    if (candidate.type === "title") {
      const title = plainText(candidate.title);
      if (title) return title;
    }
  }
  return "Pagina senza titolo";
}

export async function researchNotion(
  token: string,
  queries: string[],
  limits: { maxPages: number; maxCharacters: number },
  clientOverride?: NotionResearchClient
): Promise<NotionResearchPacket> {
  if (!token) throw new NotionResearchError("notion_not_configured", false);
  const requestedQueries = [...new Set(queries.map((query) => query.trim()).filter(Boolean))]
    .slice(0, 5)
    .map((query) => query.slice(0, 200));
  if (requestedQueries.length === 0) {
    throw new NotionResearchError("notion_research_queries_invalid", false);
  }
  const maxPages = Math.max(1, Math.min(limits.maxPages, 30));
  const maxCharacters = Math.max(5_000, Math.min(limits.maxCharacters, 120_000));
  const notion = clientOverride ?? (() => {
    const client = new Client({ auth: token });
    return {
      search: (input: Parameters<NotionResearchClient["search"]>[0]) =>
        client.search(input) as unknown as ReturnType<NotionResearchClient["search"]>,
      retrieveMarkdown: (input: Parameters<NotionResearchClient["retrieveMarkdown"]>[0]) =>
        client.pages.retrieveMarkdown(input) as unknown as ReturnType<NotionResearchClient["retrieveMarkdown"]>
    };
  })();

  const pages = new Map<string, { result: NotionResearchSearchResult; queries: string[] }>();
  let searchResultCount = 0;
  let partial = false;
  const resultsPerQuery = Math.max(1, Math.min(20, Math.ceil(maxPages / requestedQueries.length)));
  try {
    for (const query of requestedQueries) {
      const response = await notion.search({
        query,
        page_size: resultsPerQuery,
        filter: { property: "object", value: "page" },
        sort: { timestamp: "last_edited_time", direction: "descending" }
      });
      searchResultCount += response.results.length;
      partial ||= response.has_more || response.request_status?.type === "incomplete";
      for (const result of response.results) {
        if (result.object && result.object !== "page") continue;
        const existing = pages.get(result.id);
        if (existing) {
          if (!existing.queries.includes(query)) existing.queries.push(query);
        } else if (pages.size < maxPages) {
          pages.set(result.id, { result, queries: [query] });
        } else {
          partial = true;
        }
      }
    }
  } catch {
    throw new NotionResearchError("notion_search_failed", true);
  }

  const sources: NotionResearchSource[] = [];
  let inaccessiblePages = 0;
  let remainingCharacters = maxCharacters;
  const charactersPerPage = Math.max(
    1_000,
    Math.min(20_000, Math.floor(maxCharacters / Math.max(1, pages.size)))
  );
  for (const { result, queries: matchedQueries } of pages.values()) {
    if (remainingCharacters <= 0) {
      partial = true;
      break;
    }
    try {
      const page = await notion.retrieveMarkdown({ page_id: result.id, include_transcript: false });
      const markdown = page.markdown.slice(0, Math.min(remainingCharacters, charactersPerPage));
      const sourcePartial = page.truncated
        || page.unknown_block_ids.length > 0
        || markdown.length < page.markdown.length;
      partial ||= sourcePartial;
      remainingCharacters -= markdown.length;
      const title = pageTitle(result);
      const url = stringProperty(result, "url");
      const lastEditedAt = stringProperty(result, "last_edited_time");
      const contentHash = createHash("sha256").update(JSON.stringify({
        externalId: result.id,
        title,
        url,
        lastEditedAt,
        markdown
      }), "utf8").digest("hex");
      sources.push({
        reference: `N${sources.length + 1}`,
        externalId: result.id,
        title,
        url,
        lastEditedAt,
        contentHash,
        markdown,
        matchedQueries,
        partial: sourcePartial
      });
    } catch {
      inaccessiblePages += 1;
      partial = true;
    }
  }
  if (pages.size > 0 && sources.length === 0) {
    throw new NotionResearchError("notion_page_fetch_failed", true);
  }

  return {
    sources,
    coverage: {
      requestedQueries,
      searchResultCount,
      uniquePagesFound: pages.size,
      fetchedPages: sources.length,
      inaccessiblePages,
      partial,
      limits: { maxPages, maxCharacters }
    }
  };
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
