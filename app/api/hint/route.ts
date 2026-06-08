import { NextResponse } from "next/server";
import { movieHint, actorHint } from "@/lib/game";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const currentActorId = Number(body.currentActorId);
    const type = String(body.type);
    const mode = body.mode === "movie" ? "movie" : "all";
    const excludeActorIds = Array.isArray(body.excludeActorIds)
      ? body.excludeActorIds.map((value: unknown) => Number(value)).filter(Boolean)
      : [];
    if (!currentActorId) {
      return NextResponse.json({ ok: false, message: "Missing actor id." }, { status: 400 });
    }

    const result =
      type === "actor"
        ? await actorHint(currentActorId, String(body.movieTitle ?? ""), mode, excludeActorIds)
        : await movieHint(currentActorId, mode);

    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, message: e.message || "Couldn't fetch a hint." },
      { status: 500 }
    );
  }
}
