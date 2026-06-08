import { NextResponse } from "next/server";
import { searchPerson } from "@/lib/tmdb";

// Used by the optional "choose your own actors" picker.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ results: [] });
  try {
    const results = await searchPerson(q);
    return NextResponse.json({ results });
  } catch (e: any) {
    return NextResponse.json({ results: [], error: e.message }, { status: 500 });
  }
}
