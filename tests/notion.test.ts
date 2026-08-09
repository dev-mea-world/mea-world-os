import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  NotionResearchError,
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
