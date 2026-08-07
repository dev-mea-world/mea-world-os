import type { SessionPrincipal } from "@meaworld/db";
import { fingerprint, isAllowedOrigin, SESSION_COOKIE_NAME } from "@meaworld/security";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { getStore } from "./db";
import { getWebEnv } from "./env";

export function requestFingerprint(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip") || "unknown";
  return fingerprint(address, getWebEnv().SESSION_SECRET);
}

export async function getSessionToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE_NAME)?.value ?? null;
}

export async function hasValidSession(): Promise<boolean> {
  const token = await getSessionToken();
  return token ? getStore().sessionIsValid(token) : false;
}

export async function requireDashboardSession(): Promise<string> {
  const token = await getSessionToken();
  if (!token || !(await getStore().sessionIsValid(token))) {
    redirect("/login");
  }
  return token;
}

export interface AuthenticatedSession extends SessionPrincipal {
  token: string;
}

export async function requireApiSession(request: NextRequest): Promise<AuthenticatedSession> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const principal = token ? await getStore().getSessionPrincipal(token) : null;
  if (!token || !principal) {
    throw new AuthError("unauthorized", 401);
  }
  return { token, ...principal };
}

export function requireSameOrigin(request: Request): void {
  const env = getWebEnv();
  if (!isAllowedOrigin(request.url, request.headers.get("origin"), env.PUBLIC_APP_URL)) {
    throw new AuthError("invalid_origin", 403);
  }
}

export class AuthError extends Error {
  constructor(public readonly code: string, public readonly status: number) {
    super(code);
    this.name = "AuthError";
  }
}
