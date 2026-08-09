import { TelegramOutboxLeaseSchema } from "@meaworld/domain";
import { NextResponse, type NextRequest } from "next/server";
import { getStore } from "@/lib/db";
import { errorResponse } from "@/lib/http";
import { authenticateWorkerRequest } from "@/lib/worker-auth";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rawBody = await request.text();
  try {
    const authentication = await authenticateWorkerRequest(request, rawBody, true);
    const payload = TelegramOutboxLeaseSchema.parse(JSON.parse(rawBody));
    const notification = await getStore().leaseTelegramOutbox(
      authentication.workerId,
      payload.leaseSeconds,
      authentication.correlationId
    );
    return NextResponse.json({ notification });
  } catch (error) {
    return errorResponse(error);
  }
}
