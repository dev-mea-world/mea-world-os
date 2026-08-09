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

interface NotionPublishedPage {
  id: string;
  object?: string;
  url?: string;
  parent?: { type?: string; page_id?: string };
  properties?: Record<string, unknown>;
}

export interface NotionResponsePublicationClient {
  search(input: {
    query: string;
    page_size: number;
    filter: { property: "object"; value: "page" };
  }): Promise<{ results: NotionPublishedPage[] }>;
  createPage(input: Record<string, unknown>): Promise<NotionPublishedPage>;
}

export interface NotionResponsePublicationInput {
  parentPageId: string;
  sourceTaskId: string;
  sourceRunId: string;
  idempotencyKey: string;
  createdAt: string;
  response: string;
  contentHash: string;
}

export interface NotionResponsePublicationResult {
  pageId: string;
  pageUrl: string;
  title: string;
  recovered: boolean;
}

export class NotionResearchError extends Error {
  constructor(public readonly code: string, public readonly retryable: boolean) {
    super(code);
    this.name = "NotionResearchError";
  }
}

export class NotionResponsePublicationError extends Error {
  constructor(public readonly code: string, public readonly retryable: boolean) {
    super(code);
    this.name = "NotionResponsePublicationError";
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

function normalizedNotionId(value: string): string {
  return value.replaceAll("-", "").toLowerCase();
}

function validNotionId(value: string): boolean {
  return /^[a-f0-9]{32}$/i.test(normalizedNotionId(value));
}

function publicationError(error: unknown): NotionResponsePublicationError {
  const candidate = error && typeof error === "object"
    ? error as { status?: unknown; code?: unknown }
    : {};
  const status = typeof candidate.status === "number" ? candidate.status : null;
  const code = typeof candidate.code === "string" ? candidate.code : "notion_page_creation_failed";
  const retryable = status === 429
    || (status !== null && status >= 500)
    || ["conflict_error", "internal_server_error", "rate_limited", "request_timeout", "service_unavailable"].includes(code);
  return new NotionResponsePublicationError("notion_page_creation_failed", retryable);
}

function richText(content: string): Array<Record<string, unknown>> {
  return [{ type: "text", text: { content } }];
}

function publicationPage(
  results: NotionPublishedPage[],
  title: string,
  parentPageId: string
): NotionPublishedPage | null {
  return results.find((result) =>
    result.object !== "database"
    && validNotionId(result.id)
    && pageTitle(result) === title
    && result.parent?.type === "page_id"
    && typeof result.parent.page_id === "string"
    && normalizedNotionId(result.parent.page_id) === normalizedNotionId(parentPageId)
    && typeof result.url === "string"
  ) ?? null;
}

export async function publishTelegramResponseToNotion(
  token: string,
  input: NotionResponsePublicationInput,
  clientOverride?: NotionResponsePublicationClient
): Promise<NotionResponsePublicationResult> {
  if (!token || !input.parentPageId) {
    throw new NotionResponsePublicationError("notion_response_publication_not_configured", false);
  }
  const response = input.response.trim();
  const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
  const contentHash = createHash("sha256").update(response, "utf8").digest("hex");
  if (
    !response
    || response.length > 12_000
    || !/^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.test(input.parentPageId)
    || !uuid.test(input.sourceTaskId)
    || !uuid.test(input.sourceRunId)
    || !/^[a-f0-9]{64}$/.test(input.contentHash)
    || input.contentHash !== contentHash
    || input.idempotencyKey !== `telegram:notion-response:${input.sourceRunId}`
    || !Number.isFinite(Date.parse(input.createdAt))
  ) {
    throw new NotionResponsePublicationError("notion_response_publication_invalid", false);
  }

  const notion = clientOverride ?? (() => {
    const client = new Client({ auth: token });
    return {
      search: (searchInput: Parameters<NotionResponsePublicationClient["search"]>[0]) =>
        client.search(searchInput) as unknown as ReturnType<NotionResponsePublicationClient["search"]>,
      createPage: (pageInput: Record<string, unknown>) =>
        client.pages.create(pageInput as never) as unknown as ReturnType<NotionResponsePublicationClient["createPage"]>
    };
  })();
  const title = `[AI UNVALIDATED] Telegram response · ${input.sourceRunId}`;
  const findExisting = async (): Promise<NotionPublishedPage | null> => {
    const search = await notion.search({
      query: input.sourceRunId,
      page_size: 20,
      filter: { property: "object", value: "page" }
    });
    return publicationPage(search.results, title, input.parentPageId);
  };

  let existing: NotionPublishedPage | null;
  try {
    existing = await findExisting();
  } catch (error) {
    throw publicationError(error);
  }
  if (existing?.url) {
    return { pageId: existing.id, pageUrl: existing.url, title, recovered: true };
  }

  const provenance = [
    "Origin: AI-generated",
    "Validation: UNVALIDATED",
    `Source task ID: ${input.sourceTaskId}`,
    `Source run ID: ${input.sourceRunId}`,
    `Created at: ${input.createdAt}`,
    `Idempotency key: ${input.idempotencyKey}`,
    `Content SHA-256: ${input.contentHash}`
  ];
  const responseChunks = response.match(/[\s\S]{1,1_900}/g) ?? [response];
  try {
    const created = await notion.createPage({
      parent: { type: "page_id", page_id: input.parentPageId },
      properties: {
        title: {
          type: "title",
          title: richText(title)
        }
      },
      children: [
        {
          object: "block",
          type: "callout",
          callout: {
            rich_text: richText("AI-GENERATED · UNVALIDATED — This page is not human-approved or authoritative."),
            icon: { type: "emoji", emoji: "⚠️" },
            color: "yellow_background"
          }
        },
        {
          object: "block",
          type: "heading_2",
          heading_2: { rich_text: richText("Provenance") }
        },
        ...provenance.map((line) => ({
          object: "block",
          type: "bulleted_list_item",
          bulleted_list_item: { rich_text: richText(line) }
        })),
        { object: "block", type: "divider", divider: {} },
        {
          object: "block",
          type: "heading_2",
          heading_2: { rich_text: richText("Response") }
        },
        ...responseChunks.map((chunk) => ({
          object: "block",
          type: "paragraph",
          paragraph: { rich_text: richText(chunk) }
        }))
      ]
    });
    if (!created.id || !validNotionId(created.id) || typeof created.url !== "string") {
      throw new NotionResponsePublicationError("notion_page_response_invalid", true);
    }
    return { pageId: created.id, pageUrl: created.url, title, recovered: false };
  } catch (error) {
    try {
      const recovered = await findExisting();
      if (recovered?.url) {
        return { pageId: recovered.id, pageUrl: recovered.url, title, recovered: true };
      }
    } catch {
      // Preserve the sanitized creation classification below.
    }
    if (error instanceof NotionResponsePublicationError) throw error;
    throw publicationError(error);
  }
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
