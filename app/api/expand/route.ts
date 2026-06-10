import { NextResponse } from "next/server";
import { getTierActors, getDiscovered, maybeExpand, type Difficulty } from "@/lib/actor-expansion";

// Manual trigger to warm/grow a tier's discovered pool. /api/start calls the same
// maybeExpand in the background; this just lets you run a crawl on demand and see
// the before/after size. Crawls hit TMDB, so this response is not instant.
export const dynamic = "force-dynamic";

function parseDifficulty(raw: string | null): Difficulty {
  return raw === "easy" || raw === "hard" ? raw : "medium";
}

export async function GET(req: Request) {
  const difficulty = parseDifficulty(new URL(req.url).searchParams.get("difficulty"));
  const before = getTierActors(difficulty).length;
  await maybeExpand(difficulty, []);
  const after = getTierActors(difficulty).length;
  const discovered = getDiscovered(difficulty).map((a) => ({ name: a.name, knownFor: a.knownFor }));
  return NextResponse.json({ difficulty, before, after, added: after - before, discovered });
}
