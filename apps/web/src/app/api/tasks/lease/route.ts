import { LeaseRequestSchema } from "@meaworld/domain";
import { NextResponse, type NextRequest } from "next/server";
import { getStore } from "@/lib/db";
import { errorResponse } from "@/lib/http";
import { authenticateWorkerRequest } from "@/lib/worker-auth";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rawBody = await request.text();
  try {
    const authentication = await authenticateWorkerRequest(request, rawBody, true);
    const payload = LeaseRequestSchema.parse(JSON.parse(rawBody));
    const work = await getStore().leaseNextTask(
      authentication.workerId,
      payload.leaseSeconds,
      authentication.correlationId
    );
    return NextResponse.json({ work });
  } catch (error) {
    return errorResponse(error);
  }
}
