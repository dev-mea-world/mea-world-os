import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const snapshot = await getStore().dashboardSnapshot();
    return NextResponse.json({
      status: snapshot.systemStatus,
      database: "reachable",
      worker: snapshot.worker?.status ?? "missing",
      notion: snapshot.notion.status,
      timestamp: snapshot.generatedAt
    });
  } catch {
    return NextResponse.json(
      { status: "degraded", database: "unreachable", timestamp: new Date().toISOString() },
      { status: 503 }
    );
  }
}
