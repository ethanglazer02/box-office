import { NextResponse } from "next/server";
import {
  getActingCredits,
  getMovieRevenue,
  getPopularPeople,
  CreditTitle,
  PersonLite
} from "@/lib/tmdb";

// Each request must pick a fresh random pair — never cache this route.
export const dynamic = "force-dynamic";

type Difficulty = "easy" | "medium" | "hard";

interface DifficultyConfig {
  pageRange: [number, number];
  sampleCount: number;
  shortlistSize: number;
  scoreBand: [number, number];
  minEnglishMovieCredits: number;
}

interface CandidateScore {
  person: PersonLite;
  score: number;
  englishMovieCredits: number;
}

const RECENT_ACTOR_COOKIE = "sd_recent_actor_ids";
const RECENT_ACTOR_LIMIT = 12;
const TOP_REVENUE_TITLES = 5;
const TOP_VOTE_TITLES = 8;

// Difficulty is now based on a recognizability score derived from English-language
// movie credits: box-office strength, audience traction, and depth of known work.
const POOL_CONFIG: Record<Difficulty, {
  pageRange: [number, number];
  sampleCount: number;
  shortlistSize: number;
  scoreBand: [number, number];
  minEnglishMovieCredits: number;
}> = {
  easy: { pageRange: [1, 30], sampleCount: 12, shortlistSize: 28, scoreBand: [70, Infinity], minEnglishMovieCredits: 10 },
  medium: { pageRange: [1, 60], sampleCount: 16, shortlistSize: 36, scoreBand: [38, 70], minEnglishMovieCredits: 8 },
  hard: { pageRange: [8, 110], sampleCount: 18, shortlistSize: 40, scoreBand: [14, 38], minEnglishMovieCredits: 5 }
};

function parseDifficulty(raw: string | null): Difficulty {
  return raw === "easy" || raw === "hard" ? raw : "medium";
}

function randInt(lo: number, hi: number): number {
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function dedupeById(people: PersonLite[]): PersonLite[] {
  const seen = new Set<number>();
  return people.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
}

function readRecentActorIds(req: Request): number[] {
  const cookieHeader = req.headers.get("cookie") || "";
  const match = cookieHeader.match(new RegExp(`${RECENT_ACTOR_COOKIE}=([^;]+)`));
  if (!match) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(match[1]));
    return Array.isArray(parsed) ? parsed.map((value) => Number(value)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function writeRecentActorIds(res: NextResponse, actorIds: number[]) {
  res.cookies.set(RECENT_ACTOR_COOKIE, JSON.stringify(actorIds.slice(0, RECENT_ACTOR_LIMIT)), {
    httpOnly: false,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 14,
    path: "/"
  });
}

function hollywoodMovieCredits(credits: Awaited<ReturnType<typeof getActingCredits>>) {
  return credits.filter((credit) => credit.mediaType === "movie" && credit.originalLanguage === "en");
}

function topByVote(credits: CreditTitle[], count: number): CreditTitle[] {
  return [...credits].sort((a, b) => b.voteCount - a.voteCount).slice(0, count);
}

async function scoreCandidate(person: PersonLite): Promise<CandidateScore | null> {
  const credits = await getActingCredits(person.id);
  const movies = hollywoodMovieCredits(credits);
  if (movies.length === 0) return null;

  const topVotes = topByVote(movies, TOP_VOTE_TITLES);
  const topRevenueTitles = topByVote(movies, TOP_REVENUE_TITLES);
  const revenues = await Promise.all(
    topRevenueTitles.map((title) => getMovieRevenue(title.id, title.mediaType))
  );

  const revenueSum = revenues.reduce((sum, revenue) => sum + revenue, 0);
  const voteSum = topVotes.reduce((sum, title) => sum + title.voteCount, 0);
  const hits250 = revenues.filter((revenue) => revenue >= 250_000_000).length;
  const hits500 = revenues.filter((revenue) => revenue >= 500_000_000).length;
  const hits1000 = revenues.filter((revenue) => revenue >= 1_000_000_000).length;
  const creditDepth = movies.filter((title) => title.voteCount >= 200).length;

  const score =
    revenueSum / 250_000_000 +
    voteSum / 2000 +
    hits250 * 4 +
    hits500 * 7 +
    hits1000 * 10 +
    Math.min(creditDepth, 12) * 1.25;

  return {
    person,
    score,
    englishMovieCredits: movies.length
  };
}

function englishModeCredits(
  credits: Awaited<ReturnType<typeof getActingCredits>>,
  mode: "movie" | "all"
) {
  return credits.filter((credit) => {
    if (credit.originalLanguage !== "en") return false;
    return mode === "movie" ? credit.mediaType === "movie" : true;
  });
}

function sampleUniquePages([lo, hi]: [number, number], count: number): number[] {
  const pages = new Set<number>();
  while (pages.size < Math.min(count, hi - lo + 1)) {
    pages.add(randInt(lo, hi));
  }
  return [...pages];
}

// A good pair: both have enough credits AND they don't already share a title
// (sharing one would make the puzzle a one-move gimme). In movies-only mode, TV
// credits don't count toward either check.
async function pairIsGood(
  a: PersonLite,
  b: PersonLite,
  minCredits: number,
  mode: "movie" | "all"
): Promise<boolean> {
  const [caAll, cbAll] = await Promise.all([getActingCredits(a.id), getActingCredits(b.id)]);
  const caHollywood = hollywoodMovieCredits(caAll);
  const cbHollywood = hollywoodMovieCredits(cbAll);
  if (caHollywood.length < minCredits || cbHollywood.length < minCredits) return false;

  const ca = englishModeCredits(caAll, mode);
  const cb = englishModeCredits(cbAll, mode);
  const keys = new Set(ca.map((c) => `${c.mediaType}:${c.id}`));
  return !cb.some((c) => keys.has(`${c.mediaType}:${c.id}`));
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const difficulty = parseDifficulty(url.searchParams.get("difficulty"));
    const mode = url.searchParams.get("mode") === "movie" ? "movie" : "all";
    const recentActorIds = new Set(readRecentActorIds(req));
    const { pageRange, sampleCount, shortlistSize, scoreBand, minEnglishMovieCredits } = POOL_CONFIG[difficulty];

    const pages = sampleUniquePages(pageRange, sampleCount);
    const lists = await Promise.all(pages.map((p) => getPopularPeople(p).catch(() => [])));
    const broadPool = dedupeById(lists.flat())
      .sort((a, b) => (b.famePeak ?? 0) - (a.famePeak ?? 0))
      .slice(0, shortlistSize);

    const scored = (await Promise.all(broadPool.map(scoreCandidate)))
      .filter((candidate): candidate is CandidateScore => candidate !== null)
      .filter((candidate) => candidate.englishMovieCredits >= minEnglishMovieCredits);

    const [scoreMin, scoreMax] = scoreBand;
    let pool = scored
      .filter((candidate) => candidate.score >= scoreMin && candidate.score < scoreMax)
      .map((candidate) => candidate.person);

    const cooledPool = pool.filter((person) => !recentActorIds.has(person.id));
    if (cooledPool.length >= 10) {
      pool = cooledPool;
    }

    // If a given request's sampled pages don't fill the target band well enough,
    // fall back to the nearest stronger candidates rather than failing the game.
    if (pool.length < 10) {
      pool = scored
        .sort((a, b) => b.score - a.score)
        .filter((candidate) => candidate.englishMovieCredits >= minEnglishMovieCredits)
        .map((candidate) => candidate.person);
      const cooledFallback = pool.filter((person) => !recentActorIds.has(person.id));
      if (cooledFallback.length >= 10) {
        pool = cooledFallback;
      }
    }

    async function nextCandidate(): Promise<PersonLite | undefined> {
      return pool.length ? pool[Math.floor(Math.random() * pool.length)] : undefined;
    }

    const MAX_ATTEMPTS = 12;
    let start: PersonLite | undefined;
    let target: PersonLite | undefined;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const a = await nextCandidate();
      const b = await nextCandidate();
      if (!a || !b || a.id === b.id) continue;
      start = a;
      target = b;
      if (await pairIsGood(a, b, minEnglishMovieCredits, mode)) {
        const response = NextResponse.json({ start: a, target: b, difficulty, mode });
        writeRecentActorIds(response, [a.id, b.id, ...recentActorIds]);
        return response;
      }
    }

    // Fallback: couldn't satisfy every constraint in the attempts budget. Use the
    // last valid pair (still two distinct real actors) rather than failing.
    if (start && target) {
      const response = NextResponse.json({ start, target, difficulty, mode });
      writeRecentActorIds(response, [start.id, target.id, ...recentActorIds]);
      return response;
    }
    return NextResponse.json(
      { error: "Could not assemble a pair from TMDB. Try again." },
      { status: 502 }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed to start game." }, { status: 500 });
  }
}
