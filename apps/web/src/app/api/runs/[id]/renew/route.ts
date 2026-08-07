import { RunRenewSchema } from "@meaworld/domain";
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
    const payload = RunRenewSchema.parse(JSON.parse(rawBody));
    const { id } = await context.params;
    const lease = await getStore().renewRunLease(
      id,
      authentication.workerId,
      payload.leaseToken,
      payload.leaseSeconds,
      authentication.correlationId
    );
    return NextResponse.json(lease);
  } catch (error) {
    return errorResponse(error);
  }
}
