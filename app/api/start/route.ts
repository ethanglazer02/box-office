import { NextResponse } from "next/server";
import pool from "@/lib/actor-pool.json";

// Start/target pairs are drawn from a precomputed, tiered pool (built offline by
// scripts/build-actor-pool.mjs). Each request just samples a diverse, non-repeating
// pair from the right tier — no TMDB calls, so the route is instant.
export const dynamic = "force-dynamic";

type Difficulty = "easy" | "medium" | "hard";
type Mode = "movie" | "all";

interface PoolActor {
  id: number;
  name: string;
  profilePath: string | null;
  knownFor: string;
  gender: number;
  ethnicityTag: string;
  movieIds: number[];
  tvIds: number[];
  scores: { sPct: number; fPct: number; pPct: number; gap: number };
}

const TIERS = (pool as { tiers: Record<Difficulty, PoolActor[]> }).tiers;

const RECENT_ACTOR_COOKIE = "sd_recent_actor_ids";
const RECENT_ACTOR_LIMIT = 80;
const MAX_ATTEMPTS = 200;
const MIN_POOL_SIZE = 12; // below this we stop honoring the cooldown filter
// On medium, sometimes pair one easy actor with one medium actor to ease the
// jump. Never two easy at once — the mixed pair always keeps one medium side.
const MEDIUM_EASY_MIX_CHANCE = 0.3;

function parseDifficulty(raw: string | null): Difficulty {
  return raw === "easy" || raw === "hard" ? raw : "medium";
}

function readRecentActorIds(req: Request): number[] {
  const cookieHeader = req.headers.get("cookie") || "";
  const match = cookieHeader.match(new RegExp(`${RECENT_ACTOR_COOKIE}=([^;]+)`));
  if (!match) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(match[1]));
    return Array.isArray(parsed) ? parsed.map((v) => Number(v)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function writeRecentActorIds(res: NextResponse, actorIds: number[]) {
  res.cookies.set(RECENT_ACTOR_COOKIE, JSON.stringify(actorIds.slice(0, RECENT_ACTOR_LIMIT)), {
    httpOnly: false,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 14,
    path: "/",
  });
}

function toPerson(a: PoolActor) {
  return { id: a.id, name: a.name, profilePath: a.profilePath, knownFor: a.knownFor };
}

// Titles that count as a "shared credit" for the chosen mode. In movies-only mode
// TV overlaps are ignored; in all-mode both count.
function titleKeys(a: PoolActor, mode: Mode): Set<number> {
  if (mode === "movie") return new Set(a.movieIds);
  return new Set([...a.movieIds, ...a.tvIds]);
}

function sharesTitle(a: PoolActor, b: PoolActor, mode: Mode): boolean {
  const keys = titleKeys(a, mode);
  const other = mode === "movie" ? b.movieIds : [...b.movieIds, ...b.tvIds];
  return other.some((id) => keys.has(id));
}

// Higher = more diverse. Reward non-male representation and differing ethnicities
// so output isn't two white men by default.
function diversityScore(a: PoolActor, b: PoolActor): number {
  const nonMale = (g: number) => g === 1 || g === 3;
  let score = 0;
  if (nonMale(a.gender) && nonMale(b.gender)) score += 3;
  else if (nonMale(a.gender) || nonMale(b.gender)) score += 2;

  const neutral = (t: string) =>
    t === "White" || t === "US/Unknown" || t === "UK/Unknown" ||
    t === "Anglo/Unknown" || t === "Unspecified";
  if (a.ethnicityTag !== b.ethnicityTag) score += 1;
  if (!neutral(a.ethnicityTag) || !neutral(b.ethnicityTag)) score += 1;
  return score;
}

function pickTwoDistinct(arr: PoolActor[]): [PoolActor, PoolActor] | null {
  if (arr.length < 2) return null;
  const i = Math.floor(Math.random() * arr.length);
  let j = Math.floor(Math.random() * arr.length);
  if (j === i) j = (j + 1) % arr.length;
  return [arr[i], arr[j]];
}

function choosePair(
  candidates: PoolActor[],
  mode: Mode
): [PoolActor, PoolActor] | null {
  let best: { pair: [PoolActor, PoolActor]; score: number } | null = null;
  let fallback: [PoolActor, PoolActor] | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const pair = pickTwoDistinct(candidates);
    if (!pair) break;
    fallback = fallback ?? pair;
    const [a, b] = pair;
    if (sharesTitle(a, b, mode)) continue; // already linked = trivial puzzle

    const score = diversityScore(a, b) + Math.random() * 0.5; // jitter breaks ties
    if (!best || score > best.score) best = { pair, score };
    if (best.score >= 4) break; // good enough; stop early
  }

  return best?.pair ?? fallback;
}

// Pick one actor from each pool (e.g. one easy + one medium). Guarantees the
// two sides come from different tiers, so a mixed pair never has two easy actors.
function choosePairAcross(
  poolA: PoolActor[],
  poolB: PoolActor[],
  mode: Mode
): [PoolActor, PoolActor] | null {
  if (poolA.length === 0 || poolB.length === 0) return null;
  let best: { pair: [PoolActor, PoolActor]; score: number } | null = null;
  let fallback: [PoolActor, PoolActor] | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const a = poolA[Math.floor(Math.random() * poolA.length)];
    const b = poolB[Math.floor(Math.random() * poolB.length)];
    if (a.id === b.id) continue;
    const pair: [PoolActor, PoolActor] = [a, b];
    fallback = fallback ?? pair;
    if (sharesTitle(a, b, mode)) continue; // already linked = trivial puzzle

    const score = diversityScore(a, b) + Math.random() * 0.5; // jitter breaks ties
    if (!best || score > best.score) best = { pair, score };
    if (best.score >= 4) break; // good enough; stop early
  }

  return best?.pair ?? fallback;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const difficulty = parseDifficulty(url.searchParams.get("difficulty"));
    const mode: Mode = url.searchParams.get("mode") === "movie" ? "movie" : "all";
    const recent = new Set(readRecentActorIds(req));

    const cooledTier = (t: Difficulty) => {
      const tier = TIERS[t] || [];
      const cooled = tier.filter((a) => !recent.has(a.id));
      return cooled.length >= MIN_POOL_SIZE ? cooled : tier;
    };

    const candidates = cooledTier(difficulty);

    // On medium, occasionally swap one side for an easy actor to soften the
    // difficulty. The other side stays medium, so we never get two easy actors.
    const mixEasy =
      difficulty === "medium" && Math.random() < MEDIUM_EASY_MIX_CHANCE;
    const pair = mixEasy
      ? choosePairAcross(cooledTier("easy"), candidates, mode)
      : choosePair(candidates, mode);
    if (!pair) {
      return NextResponse.json(
        { error: "Actor pool is empty for this difficulty. Rebuild the pool." },
        { status: 500 }
      );
    }

    const [start, target] = pair;
    const response = NextResponse.json({
      start: toPerson(start),
      target: toPerson(target),
      difficulty,
      mode,
    });
    writeRecentActorIds(response, [start.id, target.id, ...recent]);
    return response;
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed to start game." }, { status: 500 });
  }
}
