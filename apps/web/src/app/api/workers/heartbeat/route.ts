import { HeartbeatPayloadSchema } from "@meaworld/domain";
import { NextResponse, type NextRequest } from "next/server";
import { getStore } from "@/lib/db";
import { errorResponse } from "@/lib/http";
import { authenticateWorkerRequest } from "@/lib/worker-auth";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rawBody = await request.text();
  try {
    const authentication = await authenticateWorkerRequest(request, rawBody, false);
    const payload = HeartbeatPayloadSchema.parse(JSON.parse(rawBody));
    if (payload.workerId !== authentication.workerId) {
      return NextResponse.json({ error: "worker_id_mismatch" }, { status: 401 });
    }
    const worker = await getStore().recordHeartbeat(payload, authentication.correlationId);
    return NextResponse.json({ worker });
  } catch (error) {
    return errorResponse(error);
  }
}
