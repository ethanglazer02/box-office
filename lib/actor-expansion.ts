// Live actor expansion. Keeps gameplay supplied with FRESH faces without ever
// dropping below the fame level of the current pool.
//
// How the two guarantees are met:
//   - always-fresh: when a tier runs low on unseen actors, we crawl the co-stars
//     of actors already in that tier (same era/genre/fame neighborhood) from TMDB
//     and fold the survivors into an in-memory pool that /api/start blends in.
//   - never-obscure: every candidate is scored with the same star-power (S) /
//     familiarity (F) formulas the offline build uses, then admitted ONLY if it
//     clears that tier's absolute floor in lib/tier-cutoffs.json. Anything below
//     the floor is rejected, so a player can never be served someone unrecognizable.
//
// The committed actor-pool.json is the permanent floor; discovered actors live in
// memory (lost on redeploy, harmless — they get rediscovered, and the static pool
// already lasts ~40 games via the cooldown). Swap `discovered` for a KV store to
// persist across deploys.

import pool from "@/lib/actor-pool.json";
import cutoffsData from "@/lib/tier-cutoffs.json";
import ethnicityData from "@/lib/ethnicity-tags.json";
import { getCombinedCreditsRaw, getPersonMeta, getTitleCast, type CombinedCredit } from "@/lib/tmdb";

export type Difficulty = "easy" | "medium" | "hard";

export interface PoolActor {
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
const CUTOFFS = (cutoffsData as { cutoffs: Record<Difficulty, TierCutoff> }).cutoffs;
const CURATED = (ethnicityData as { tags: Record<string, { name: string; tag: string }> }).tags;

interface TierCutoff {
  fFloor: number;
  fMedian: number;
  sFloor: number;
  sMedian: number;
  sCeil: number;
}

// ---- scoring (mirrors build-actor-pool.mjs / derive-tier-cutoffs.mjs) --------
const QUALIFY_VOTE_GTE = 200;
const QUALIFY_MAX_ORDER = 15;
const filmWeight = (voteCount: number) => Math.log10(Math.max(voteCount, 1));
const billing = (order: number) => Math.exp(-(order == null || order < 0 ? 50 : order) / 2.5);

function scoreCredits(credits: CombinedCredit[]): { s: number; f: number; counted: number } {
  let s = 0;
  let f = 0;
  let counted = 0;
  for (const c of credits) {
    if (c.mediaType !== "movie" || c.originalLanguage !== "en") continue;
    if (c.voteCount < QUALIFY_VOTE_GTE || c.order > QUALIFY_MAX_ORDER) continue;
    if (c.character.toLowerCase().includes("voice)")) continue;
    const w = filmWeight(c.voteCount);
    f += w;
    s += w * billing(c.order);
    counted++;
  }
  return { s, f, counted };
}

// The fame gate. F floor (recognizability) applies to every tier — that's the
// anti-obscurity guarantee. The S band preserves each tier's shape: easy wants
// real star power (and more is fine), medium must stay mid, hard must stay LOW
// star power so a megastar can't slip in as a "hard" clue.
function passesGate(difficulty: Difficulty, s: number, f: number, counted: number): boolean {
  if (counted === 0) return false;
  const c = CUTOFFS[difficulty];
  if (f < c.fFloor) return false;
  if (difficulty === "easy") return s >= c.sFloor;
  if (difficulty === "medium") return s >= c.sFloor && s <= c.sCeil;
  return s <= c.sCeil; // hard: low star power is the whole point
}

// ---- ethnicity proxy (mirrors build-actor-pool.mjs) -------------------------
const COUNTRY_PROXY: Record<string, string> = {
  USA: "US/Unknown", "United States of America": "US/Unknown",
  UK: "UK/Unknown", "United Kingdom": "UK/Unknown", England: "UK/Unknown",
  Scotland: "UK/Unknown", Wales: "UK/Unknown",
  Canada: "Anglo/Unknown", Australia: "Anglo/Unknown", "New Zealand": "Anglo/Unknown",
  Ireland: "White", France: "White", Germany: "White", Italy: "White",
  Sweden: "White", Norway: "White", Denmark: "White", Russia: "White", Netherlands: "White",
  Nigeria: "Black", Ghana: "Black", Kenya: "Black", "South Africa": "Black",
  Mexico: "Latino", Spain: "Latino", Colombia: "Latino", Argentina: "Latino",
  Cuba: "Latino", Brazil: "Latino", "Puerto Rico": "Latino",
  "Dominican Republic": "Latino", Venezuela: "Latino", Chile: "Latino",
  China: "East Asian", Japan: "East Asian", "South Korea": "East Asian",
  "Hong Kong": "East Asian", Taiwan: "East Asian", Malaysia: "East Asian",
  India: "South Asian", Pakistan: "South Asian", Bangladesh: "South Asian", "Sri Lanka": "South Asian",
  Egypt: "MENA", Iran: "MENA", Lebanon: "MENA", Israel: "MENA", Turkey: "MENA", Morocco: "MENA",
};

function ethnicityTag(id: number, placeOfBirth: string | null): string {
  const curated = CURATED[String(id)];
  if (curated) return curated.tag;
  if (!placeOfBirth) return "Unspecified";
  const country = placeOfBirth.split(",").pop()!.trim();
  return COUNTRY_PROXY[country] || "Unspecified";
}

// ---- in-memory discovered store ---------------------------------------------
const discovered: Record<Difficulty, PoolActor[]> = { easy: [], medium: [], hard: [] };
const knownIds = new Set<number>(); // pool + discovered: never re-add
const triedIds = new Set<number>(); // already scored (pass OR fail): never re-score
const lastRun: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 0 };
const inFlight = new Set<Difficulty>();

for (const t of ["easy", "medium", "hard"] as Difficulty[]) {
  for (const a of TIERS[t] || []) knownIds.add(a.id);
}

// The full live pool for a tier: committed actors plus anything discovered so far.
export function getTierActors(difficulty: Difficulty): PoolActor[] {
  return [...(TIERS[difficulty] || []), ...discovered[difficulty]];
}

// Actors discovered live for a tier (excludes the committed pool). For debugging.
export function getDiscovered(difficulty: Difficulty): PoolActor[] {
  return discovered[difficulty];
}

// ---- expansion config -------------------------------------------------------
const SEED_MOVIES = 3; // films whose casts we mine for co-stars per run
const MAX_SCORE_PER_RUN = 25; // candidates scored before giving up for this run
const ADD_PER_RUN = 8; // actors admitted per run (grows the pool incrementally)
const THROTTLE_MS = 10_000; // don't re-crawl a tier more often than this

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function enrich(
  id: number,
  credits: CombinedCredit[]
): Promise<PoolActor | null> {
  const meta = await getPersonMeta(id);
  if (!meta || !meta.profilePath) return null; // need a recognizable face

  const englishMovies = credits.filter((c) => c.mediaType === "movie" && c.originalLanguage === "en");
  const movieIds = [...new Set(englishMovies.map((c) => c.id))];
  const tvIds = [
    ...new Set(credits.filter((c) => c.mediaType === "tv" && c.originalLanguage === "en").map((c) => c.id)),
  ];
  if (movieIds.length === 0) return null;

  const knownFor = [...englishMovies]
    .sort((a, b) => b.voteCount - a.voteCount)
    .map((c) => c.title)
    .filter(Boolean)
    .slice(0, 3)
    .join(", ");

  return {
    id,
    name: meta.name,
    profilePath: meta.profilePath,
    knownFor,
    gender: meta.gender,
    ethnicityTag: ethnicityTag(id, meta.placeOfBirth),
    movieIds,
    tvIds,
    // Percentile scores aren't recomputed live (and /api/start doesn't read them);
    // admission is governed by the absolute gate above.
    scores: { sPct: 0, fPct: 0, pPct: 0, gap: 0 },
  };
}

// One crawl pass: mine co-stars of a few tier actors, score them, and admit the
// ones that clear the gate. Returns how many fresh actors were added.
async function expandTier(difficulty: Difficulty, seen: Set<number>): Promise<number> {
  const seeds = shuffle(getTierActors(difficulty)).slice(0, 10);
  const seedMovieIds = shuffle([...new Set(seeds.flatMap((a) => a.movieIds))]).slice(0, SEED_MOVIES);

  const candidateIds = new Set<number>();
  for (const movieId of seedMovieIds) {
    const cast = await getTitleCast(movieId, "movie").catch(() => []);
    for (const c of cast) {
      if (knownIds.has(c.id) || triedIds.has(c.id) || seen.has(c.id)) continue;
      candidateIds.add(c.id);
    }
  }

  let added = 0;
  let scored = 0;
  for (const id of shuffle([...candidateIds])) {
    if (added >= ADD_PER_RUN || scored >= MAX_SCORE_PER_RUN) break;
    triedIds.add(id);
    scored++;

    const credits = await getCombinedCreditsRaw(id).catch(() => null);
    if (!credits) continue;
    const { s, f, counted } = scoreCredits(credits);
    if (!passesGate(difficulty, s, f, counted)) continue;

    const actor = await enrich(id, credits);
    if (!actor) continue;

    discovered[difficulty].push(actor);
    knownIds.add(id);
    added++;
  }
  return added;
}

// Fire-and-forget entry point. Safe to call on every request: it self-throttles
// and de-duplicates concurrent crawls, so it only does real work when a tier is
// genuinely low and isn't already being topped up.
export async function maybeExpand(difficulty: Difficulty, seenIds: number[]): Promise<void> {
  if (inFlight.has(difficulty)) return;
  if (Date.now() - lastRun[difficulty] < THROTTLE_MS) return;

  inFlight.add(difficulty);
  try {
    await expandTier(difficulty, new Set(seenIds));
  } catch {
    // best-effort: a failed crawl just means we serve from the existing pool
  } finally {
    lastRun[difficulty] = Date.now();
    inFlight.delete(difficulty);
  }
}
