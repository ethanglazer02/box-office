import { NextResponse } from "next/server";
import { resolveHintRequest } from "@/lib/hint-request";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { result, status } = await resolveHintRequest(body);
    return NextResponse.json(result, { status });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, message: e.message || "Couldn't fetch a hint." },
      { status: 500 }
    );
  }
}
