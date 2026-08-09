import { TelegramOutboxCompleteSchema } from "@meaworld/domain";
import { NextResponse, type NextRequest } from "next/server";
import { getStore } from "@/lib/db";
import { errorResponse } from "@/lib/http";
import { authenticateWorkerRequest } from "@/lib/worker-auth";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const rawBody = await request.text();
  try {
    const authentication = await authenticateWorkerRequest(request, rawBody, true);
    const payload = TelegramOutboxCompleteSchema.parse(JSON.parse(rawBody));
    const { id } = await context.params;
    await getStore().completeTelegramOutbox(
      id,
      authentication.workerId,
      payload,
      authentication.correlationId
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
