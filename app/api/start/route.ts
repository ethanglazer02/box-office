import { NextResponse, after } from "next/server";
import { getTierActors, maybeExpand, type Difficulty, type PoolActor } from "@/lib/actor-expansion";

// Start/target pairs are drawn from a tiered pool (built offline by
// scripts/build-actor-pool.mjs, grown over time by live expansion). Each request
// just samples a random, non-repeating pair from the right tier — no blocking
// TMDB calls, so the route stays instant; any expansion runs after the response.
export const dynamic = "force-dynamic";

type Mode = "movie" | "all";

const RECENT_ACTOR_COOKIE = "sd_recent_actor_ids";
const RECENT_MATCHUP_COOKIE = "sd_recent_matchup_keys";
const RECENT_ACTOR_LIMIT = 80;
const RECENT_MATCHUP_LIMIT = 160;
const MIN_POOL_SIZE = 12; // below this we stop honoring the cooldown filter
// On medium, sometimes pair one easy actor with one medium actor to ease the
// jump. Never two easy at once — the mixed pair always keeps one medium side.
const MEDIUM_EASY_MIX_CHANCE = 0.3;
// On hard, keep most pairings fully hard, but occasionally blend in one actor
// from an easier tier so the pool doesn't feel too narrow.
const HARD_MEDIUM_MIX_CHANCE = 0.2;
const HARD_EASY_MIX_CHANCE = 0.06;
// When a tier has fewer than this many unseen actors left, kick off a background
// crawl to discover fresh, equally-recognizable faces for next time.
const FRESH_LOW_WATERMARK = 40;

function parseDifficulty(raw: string | null): Difficulty {
  return raw === "easy" || raw === "hard" ? raw : "medium";
}

function readRecentActorIds(req: Request): number[] {
  const match = readCookie(req, RECENT_ACTOR_COOKIE);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match);
    return Array.isArray(parsed) ? parsed.map((v) => Number(v)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function readRecentMatchupKeys(req: Request): string[] {
  const match = readCookie(req, RECENT_MATCHUP_COOKIE);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match);
    return Array.isArray(parsed) ? parsed.map((v) => String(v)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function writeRecentActorIds(res: NextResponse, actorIds: number[]) {
  res.cookies.set(RECENT_ACTOR_COOKIE, JSON.stringify(unique(actorIds).slice(0, RECENT_ACTOR_LIMIT)), {
    httpOnly: false,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 14,
    path: "/",
  });
}

function writeRecentMatchupKeys(res: NextResponse, matchupKeys: string[]) {
  res.cookies.set(RECENT_MATCHUP_COOKIE, JSON.stringify(unique(matchupKeys).slice(0, RECENT_MATCHUP_LIMIT)), {
    httpOnly: false,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 14,
    path: "/",
  });
}

function readCookie(req: Request, name: string): string | null {
  const cookieHeader = req.headers.get("cookie") || "";
  const match = cookieHeader.match(new RegExp(`${name}=([^;]+)`));
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
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

function pairKey(a: PoolActor, b: PoolActor): string {
  return a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
}

function randomInt(max: number): number {
  return Math.floor(Math.random() * max);
}

function shuffleOrder(pair: [PoolActor, PoolActor]): [PoolActor, PoolActor] {
  return Math.random() < 0.5 ? pair : [pair[1], pair[0]];
}

function chooseRandom<T>(items: T[]): T | null {
  if (items.length === 0) return null;
  return items[randomInt(items.length)];
}

function choosePair(
  candidates: PoolActor[],
  mode: Mode,
  recentMatchups: Set<string>
): [PoolActor, PoolActor] | null {
  const unseen: [PoolActor, PoolActor][] = [];
  const all: [PoolActor, PoolActor][] = [];

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i];
      const b = candidates[j];
      if (sharesTitle(a, b, mode)) continue; // already linked = trivial puzzle
      const pair: [PoolActor, PoolActor] = [a, b];
      all.push(pair);
      if (!recentMatchups.has(pairKey(a, b))) unseen.push(pair);
    }
  }

  const chosen = chooseRandom(unseen) ?? chooseRandom(all);
  return chosen ? shuffleOrder(chosen) : null;
}

function choosePairAcross(
  poolA: PoolActor[],
  poolB: PoolActor[],
  mode: Mode,
  recentMatchups: Set<string>
): [PoolActor, PoolActor] | null {
  if (poolA.length === 0 || poolB.length === 0) return null;
  const unseen: [PoolActor, PoolActor][] = [];
  const all: [PoolActor, PoolActor][] = [];
  const seenKeys = new Set<string>();

  for (const a of poolA) {
    for (const b of poolB) {
      if (a.id === b.id) continue;
      const key = pairKey(a, b);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      const pair: [PoolActor, PoolActor] = [a, b];
      if (sharesTitle(a, b, mode)) continue; // already linked = trivial puzzle
      all.push(pair);
      if (!recentMatchups.has(key)) unseen.push(pair);
    }
  }

  const chosen = chooseRandom(unseen) ?? chooseRandom(all);
  return chosen ? shuffleOrder(chosen) : null;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const difficulty = parseDifficulty(url.searchParams.get("difficulty"));
    const mode: Mode = url.searchParams.get("mode") === "movie" ? "movie" : "all";
    const recent = new Set(readRecentActorIds(req));
    const recentMatchups = new Set(readRecentMatchupKeys(req));

    const cooledTier = (t: Difficulty) => {
      const tier = getTierActors(t);
      const cooled = tier.filter((a) => !recent.has(a.id));
      return cooled.length >= MIN_POOL_SIZE ? cooled : tier;
    };

    const candidates = cooledTier(difficulty);

    // Mixed-tier pulls always keep at least one actor from the selected
    // difficulty, so medium never becomes easy/easy and hard never becomes
    // medium/medium or easy/easy.
    const hardRoll = Math.random();
    const pair =
      difficulty === "medium" && Math.random() < MEDIUM_EASY_MIX_CHANCE
        ? choosePairAcross(cooledTier("easy"), candidates, mode, recentMatchups)
        : difficulty === "hard" && hardRoll < HARD_EASY_MIX_CHANCE
          ? choosePairAcross(cooledTier("easy"), candidates, mode, recentMatchups)
          : difficulty === "hard" && hardRoll < HARD_EASY_MIX_CHANCE + HARD_MEDIUM_MIX_CHANCE
            ? choosePairAcross(cooledTier("medium"), candidates, mode, recentMatchups)
            : choosePair(candidates, mode, recentMatchups);
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
    writeRecentMatchupKeys(response, [pairKey(start, target), ...recentMatchups]);

    // If this tier is running low on unseen faces, discover more after the
    // response ships. maybeExpand self-throttles, so this is cheap to call.
    const seenAfter = [start.id, target.id, ...recent];
    if (candidates.length - 2 < FRESH_LOW_WATERMARK) {
      after(() => maybeExpand(difficulty, seenAfter));
    }
    return response;
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed to start game." }, { status: 500 });
  }
}
