import { beforeEach, describe, expect, it, vi } from "vitest";

import { sampleNotionInventory } from "@meaworld/notion";

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
