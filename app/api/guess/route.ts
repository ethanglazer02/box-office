import { NextResponse } from "next/server";
import { validateGuess } from "@/lib/game";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const currentActorId = Number(body.currentActorId);
    const targetActorId = Number(body.targetActorId);
    const movieTitle = String(body.movieTitle ?? "");
    const costarName = String(body.costarName ?? "");
    const mode = body.mode === "movie" ? "movie" : "all";

    if (!currentActorId || !targetActorId) {
      return NextResponse.json({ valid: false, message: "Missing actor ids." }, { status: 400 });
    }

    const result = await validateGuess({
      currentActorId,
      targetActorId,
      movieTitle,
      costarName,
      mode
    });
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json(
      { valid: false, message: e.message || "Something went wrong validating that guess." },
      { status: 500 }
    );
  }
}
