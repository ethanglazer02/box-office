import { NextResponse } from "next/server";
import { getPerson } from "@/lib/tmdb";

export async function GET(req: Request) {
  const rawIds = new URL(req.url).searchParams.get("ids")?.trim();
  if (!rawIds) return NextResponse.json({ results: [] });

  const ids = [...new Set(
    rawIds
      .split(",")
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0)
  )];

  if (ids.length === 0) return NextResponse.json({ results: [] });

  try {
    const people = await Promise.all(ids.map((id) => getPerson(id)));
    return NextResponse.json({ results: people.filter(Boolean) });
  } catch (e: any) {
    return NextResponse.json({ results: [], error: e.message }, { status: 500 });
  }
}
