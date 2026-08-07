import { StoreError } from "@meaworld/db";
import { NextResponse } from "next/server";
import { AuthError } from "./auth";
import { WorkerAuthError } from "./worker-auth";

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof StoreError || error instanceof AuthError || error instanceof WorkerAuthError) {
    return NextResponse.json({ error: error.code }, { status: error.status });
  }
  if (error && typeof error === "object" && "issues" in error) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  return NextResponse.json({ error: "internal_error" }, { status: 500 });
}
