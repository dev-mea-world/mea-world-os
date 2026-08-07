import { RunStartSchema } from "@meaworld/domain";
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
    const payload = RunStartSchema.parse(JSON.parse(rawBody));
    const { id } = await context.params;
    const run = await getStore().startRun(
      id,
      authentication.workerId,
      payload.leaseToken,
      authentication.correlationId
    );
    return NextResponse.json({ run });
  } catch (error) {
    return errorResponse(error);
  }
}
