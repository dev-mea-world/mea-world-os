import { RunCompleteSchema } from "@meaworld/domain";
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
    const payload = RunCompleteSchema.parse(JSON.parse(rawBody));
    const { id } = await context.params;
    const result = await getStore().completeRun(
      id,
      authentication.workerId,
      payload,
      authentication.correlationId
    );
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
