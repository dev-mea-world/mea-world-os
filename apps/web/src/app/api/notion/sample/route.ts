import { z } from "zod";
import { NextResponse, type NextRequest } from "next/server";
import { getStore } from "@/lib/db";
import { errorResponse } from "@/lib/http";
import { authenticateWorkerRequest } from "@/lib/worker-auth";

const NotionSampleSchema = z.object({
  objects: z.array(z.object({
    externalId: z.string().min(1),
    objectType: z.string().min(1),
    url: z.string().url().nullable(),
    lastEditedAt: z.string().datetime().nullable(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    metadata: z.record(z.string(), z.unknown())
  })).max(20),
  truncated: z.boolean(),
  nextCursor: z.string().nullable(),
  status: z.enum(["sampled", "failed"]),
  errorCode: z.string().max(128).nullable()
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rawBody = await request.text();
  try {
    const authentication = await authenticateWorkerRequest(request, rawBody, true);
    const payload = NotionSampleSchema.parse(JSON.parse(rawBody));
    const runId = await getStore().recordNotionSample(payload, authentication.correlationId);
    return NextResponse.json({ runId });
  } catch (error) {
    return errorResponse(error);
  }
}
