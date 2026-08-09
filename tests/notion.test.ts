import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  NotionResearchError,
  NotionResponsePublicationError,
  publishTelegramResponseToNotion,
  researchNotion,
  sampleNotionInventory
} from "@meaworld/notion";

describe("bounded read-only Notion inventory", () => {
  const search = vi.fn();
  beforeEach(() => search.mockReset());

  it("uses only search, caps the sample, and returns stable inventory metadata", async () => {
    search.mockResolvedValue({
      results: [
        {
          id: "2ee35a7f-10b2-80e7-9460-e11db0d10a22",
          object: "page",
          url: "https://notion.so/example",
          last_edited_time: "2026-08-07T12:00:00.000Z",
          properties: { title: "content intentionally not persisted" }
        }
      ],
      has_more: true,
      next_cursor: "next-page"
    });

    const sample = await sampleNotionInventory("test-token", 200, { search });
    expect(search).toHaveBeenCalledOnce();
    expect(search).toHaveBeenCalledWith({ page_size: 20 });
    expect(sample).toEqual({
      objects: [{
        externalId: "2ee35a7f-10b2-80e7-9460-e11db0d10a22",
        objectType: "page",
        url: "https://notion.so/example",
        lastEditedAt: "2026-08-07T12:00:00.000Z",
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        metadata: { sampleOnly: true }
      }],
      truncated: true,
      nextCursor: "next-page"
    });
    expect(JSON.stringify(sample)).not.toContain("content intentionally not persisted");
  });
});

describe("bounded read-only Notion research", () => {
  it("deduplicates search results, retrieves markdown, and records measured coverage", async () => {
    const researchSearch = vi.fn()
      .mockResolvedValueOnce({
        results: [{
          id: "page-commerciale",
          object: "page",
          url: "https://notion.so/commerciale",
          last_edited_time: "2026-08-08T10:00:00.000Z",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Pipeline Commerciale" }] }
          }
        }],
        has_more: false,
        next_cursor: null
      })
      .mockResolvedValueOnce({
        results: [{
          id: "page-commerciale",
          object: "page",
          url: "https://notion.so/commerciale",
          last_edited_time: "2026-08-08T10:00:00.000Z",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Pipeline Commerciale" }] }
          }
        }],
        has_more: true,
        next_cursor: "more"
      });
    const retrieveMarkdown = vi.fn().mockResolvedValue({
      markdown: "# Pipeline\n\nProcesso e formazione commerciale.",
      truncated: false,
      unknown_block_ids: []
    });

    const packet = await researchNotion(
      "test-token",
      ["Pipeline Commerciale", "Formazione commerciale", "Pipeline Commerciale"],
      { maxPages: 10, maxCharacters: 20_000 },
      { search: researchSearch, retrieveMarkdown }
    );

    expect(researchSearch).toHaveBeenCalledTimes(2);
    expect(retrieveMarkdown).toHaveBeenCalledOnce();
    expect(packet.sources).toEqual([expect.objectContaining({
      reference: "N1",
      externalId: "page-commerciale",
      title: "Pipeline Commerciale",
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      matchedQueries: ["Pipeline Commerciale", "Formazione commerciale"],
      partial: false
    })]);
    expect(packet.coverage).toMatchObject({
      requestedQueries: ["Pipeline Commerciale", "Formazione commerciale"],
      searchResultCount: 2,
      uniquePagesFound: 1,
      fetchedPages: 1,
      inaccessiblePages: 0,
      partial: true
    });
  });

  it("fails retryably when search or every page fetch fails", async () => {
    await expect(researchNotion(
      "test-token",
      ["Commerciale"],
      { maxPages: 5, maxCharacters: 10_000 },
      {
        search: vi.fn().mockRejectedValue(new Error("secret response")),
        retrieveMarkdown: vi.fn()
      }
    )).rejects.toEqual(expect.objectContaining<Partial<NotionResearchError>>({
      code: "notion_search_failed",
      retryable: true
    }));

    await expect(researchNotion(
      "test-token",
      ["Commerciale"],
      { maxPages: 5, maxCharacters: 10_000 },
      {
        search: vi.fn().mockResolvedValue({
          results: [{ id: "page-1", object: "page" }],
          has_more: false,
          next_cursor: null
        }),
        retrieveMarkdown: vi.fn().mockRejectedValue(new Error("not shared"))
      }
    )).rejects.toEqual(expect.objectContaining<Partial<NotionResearchError>>({
      code: "notion_page_fetch_failed",
      retryable: true
    }));
  });
});

describe("governed Telegram response publication", () => {
  const response = "Risposta completa. ".repeat(300);
  const input = {
    parentPageId: "11111111-1111-4111-8111-111111111111",
    sourceTaskId: "22222222-2222-4222-8222-222222222222",
    sourceRunId: "33333333-3333-4333-8333-333333333333",
    idempotencyKey: "telegram:notion-response:33333333-3333-4333-8333-333333333333",
    createdAt: "2026-08-09T12:00:00.000Z",
    response,
    contentHash: createHash("sha256").update(response.trim(), "utf8").digest("hex")
  };

  it("creates only a new, visibly unvalidated page with provenance and bounded blocks", async () => {
    const search = vi.fn().mockResolvedValue({ results: [] });
    const createPage = vi.fn().mockResolvedValue({
      id: "44444444-4444-4444-8444-444444444444",
      object: "page",
      url: "https://notion.so/44444444444444448444444444444444"
    });

    const published = await publishTelegramResponseToNotion(
      "test-token",
      input,
      { search, createPage }
    );

    expect(published).toEqual({
      pageId: "44444444-4444-4444-8444-444444444444",
      pageUrl: "https://notion.so/44444444444444448444444444444444",
      title: `[AI UNVALIDATED] Telegram response · ${input.sourceRunId}`,
      recovered: false
    });
    expect(search).toHaveBeenCalledWith({
      query: input.sourceRunId,
      page_size: 20,
      filter: { property: "object", value: "page" }
    });
    expect(createPage).toHaveBeenCalledOnce();
    const pageInput = createPage.mock.calls[0]?.[0] as {
      parent: Record<string, unknown>;
      properties: Record<string, unknown>;
      children: Array<Record<string, unknown>>;
    };
    expect(pageInput.parent).toEqual({ type: "page_id", page_id: input.parentPageId });
    expect(JSON.stringify(pageInput.properties)).toContain("AI UNVALIDATED");
    const serializedChildren = JSON.stringify(pageInput.children);
    expect(serializedChildren).toContain("AI-GENERATED · UNVALIDATED");
    expect(serializedChildren).toContain(`Source task ID: ${input.sourceTaskId}`);
    expect(serializedChildren).toContain(`Source run ID: ${input.sourceRunId}`);
    expect(serializedChildren).toContain(`Created at: ${input.createdAt}`);
    expect(serializedChildren).toContain(`Idempotency key: ${input.idempotencyKey}`);
    expect(serializedChildren).toContain(`Content SHA-256: ${input.contentHash}`);
    expect(serializedChildren).toContain(input.response.slice(0, 500));
    expect(pageInput.children.length).toBeLessThanOrEqual(100);
  });

  it("recovers an existing page by exact title, parent, and idempotent run marker", async () => {
    const title = `[AI UNVALIDATED] Telegram response · ${input.sourceRunId}`;
    const createPage = vi.fn();
    const published = await publishTelegramResponseToNotion("test-token", input, {
      search: vi.fn().mockResolvedValue({
        results: [{
          id: "55555555-5555-4555-8555-555555555555",
          object: "page",
          url: "https://notion.so/55555555555545558555555555555555",
          parent: { type: "page_id", page_id: input.parentPageId.replaceAll("-", "") },
          properties: {
            Name: { type: "title", title: [{ plain_text: title }] }
          }
        }]
      }),
      createPage
    });

    expect(published).toMatchObject({
      pageId: "55555555-5555-4555-8555-555555555555",
      pageUrl: "https://notion.so/55555555555545558555555555555555",
      recovered: true
    });
    expect(createPage).not.toHaveBeenCalled();
  });

  it("fails closed without creating when the idempotency lookup is unavailable", async () => {
    const createPage = vi.fn();
    await expect(publishTelegramResponseToNotion("test-token", input, {
      search: vi.fn().mockRejectedValue({ status: 503 }),
      createPage
    })).rejects.toMatchObject<Partial<NotionResponsePublicationError>>({
      code: "notion_page_creation_failed",
      retryable: true
    });
    expect(createPage).not.toHaveBeenCalled();
  });
});
