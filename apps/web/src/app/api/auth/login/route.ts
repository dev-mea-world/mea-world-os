import { constantTimeEqualText, SESSION_COOKIE_NAME } from "@meaworld/security";
import { NextResponse, type NextRequest } from "next/server";
import { getStore } from "@/lib/db";
import { getWebEnv } from "@/lib/env";
import { requestFingerprint, requireSameOrigin } from "@/lib/auth";
import { errorResponse } from "@/lib/http";

function errorPage(message: string, status: number, retryAfter?: number): NextResponse {
  const headers: Record<string, string> = { "content-type": "text/html; charset=utf-8" };
  if (retryAfter) headers["retry-after"] = String(retryAfter);
  return new NextResponse(
    `<!doctype html><html><body><p>${message}</p><a href="/login">Riprova</a></body></html>`,
    { status, headers }
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    requireSameOrigin(request);
    const store = getStore();
    const identity = requestFingerprint(request);
    const rateLimit = await store.checkLoginRateLimit(identity);
    if (!rateLimit.allowed) {
      return errorPage("Troppi tentativi. Riprova più tardi.", 429, rateLimit.retryAfterSeconds);
    }

    const form = await request.formData();
    const accessCode = form.get("accessCode");
    if (
      typeof accessCode !== "string" ||
      !constantTimeEqualText(accessCode, getWebEnv().DASHBOARD_ACCESS_CODE)
    ) {
      const updatedLimit = await store.recordFailedLogin(identity);
      if (!updatedLimit.allowed) {
        return errorPage("Troppi tentativi. Riprova più tardi.", 429, updatedLimit.retryAfterSeconds);
      }
      return errorPage("Codice non valido.", 401);
    }

    await store.clearLoginFailures(identity);
    const session = await store.createSession(identity);
    const response = NextResponse.redirect(new URL("/", getWebEnv().PUBLIC_APP_URL), 303);
    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: session.token,
      httpOnly: true,
      secure: new URL(getWebEnv().PUBLIC_APP_URL).protocol === "https:",
      sameSite: "strict",
      path: "/",
      expires: new Date(session.expiresAt)
    });
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
