import { ProposalDecisionSchema } from "@meaworld/domain";
import { NextResponse, type NextRequest } from "next/server";
import { requireApiSession, requireSameOrigin } from "@/lib/auth";
import { getStore } from "@/lib/db";
import { getWebEnv } from "@/lib/env";
import { errorResponse } from "@/lib/http";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    requireSameOrigin(request);
    const session = await requireApiSession(request);
    const form = await request.formData();
    const payload = ProposalDecisionSchema.parse({
      decision: form.get("decision"),
      expectedHash: form.get("expectedHash"),
      reason: form.get("reason") ?? ""
    });
    const { id } = await context.params;
    await getStore().decideProposal(
      id,
      payload.decision,
      payload.expectedHash,
      session.actorFingerprint,
      payload.reason
    );
    return NextResponse.redirect(new URL("/?decision=recorded", getWebEnv().PUBLIC_APP_URL), 303);
  } catch (error) {
    return errorResponse(error);
  }
}
