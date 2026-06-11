import { NextResponse } from "next/server";

// Cheap liveness probe for host health checks (Railway/Fly/Render). No TMDB call.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ok: true });
}
