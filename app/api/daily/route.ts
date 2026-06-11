import { NextResponse } from "next/server";
import { getDailyReel, getTodayDailyReel } from "@/lib/daily-reel";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const date = url.searchParams.get("date")?.trim();
    const matchup = date ? getDailyReel(date) : getTodayDailyReel();

    return NextResponse.json({
      ...matchup,
      variant: "daily",
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to load the Daily Reel." },
      { status: 400 }
    );
  }
}
