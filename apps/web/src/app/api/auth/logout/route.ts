import { SESSION_COOKIE_NAME } from "@meaworld/security";
import { NextResponse, type NextRequest } from "next/server";
import { requireApiSession, requireSameOrigin } from "@/lib/auth";
import { getStore } from "@/lib/db";
import { getWebEnv } from "@/lib/env";
import { errorResponse } from "@/lib/http";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    requireSameOrigin(request);
    const session = await requireApiSession(request);
    await getStore().revokeSession(session.token);
    const response = NextResponse.redirect(new URL("/login", getWebEnv().PUBLIC_APP_URL), 303);
    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: "",
      httpOnly: true,
      secure: new URL(getWebEnv().PUBLIC_APP_URL).protocol === "https:",
      sameSite: "strict",
      path: "/",
      expires: new Date(0)
    });
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
