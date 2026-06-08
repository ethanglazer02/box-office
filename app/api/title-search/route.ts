import { NextResponse } from "next/server";
import { searchTitles } from "@/lib/tmdb";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  const mode = url.searchParams.get("mode") === "movie" ? "movie" : "all";
  if (!q) return NextResponse.json({ results: [] });
  try {
    const results = await searchTitles(q, mode);
    return NextResponse.json({ results });
  } catch (e: any) {
    return NextResponse.json({ results: [], error: e.message }, { status: 500 });
  }
}
