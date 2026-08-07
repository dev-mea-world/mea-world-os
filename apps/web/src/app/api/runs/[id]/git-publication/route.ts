import { GitPublicationCommandSchema } from "@meaworld/domain";
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
    const command = GitPublicationCommandSchema.parse(JSON.parse(rawBody));
    const { id } = await context.params;
    const publication = await getStore().recordGitPublication(
      id,
      authentication.workerId,
      command,
      authentication.correlationId
    );
    return NextResponse.json({ publication });
  } catch (error) {
    return errorResponse(error);
  }
}
