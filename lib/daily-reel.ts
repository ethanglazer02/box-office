import poolData from "./actor-pool.json" with { type: "json" };

export type DailyReelTier = "easy" | "medium";
export type DailyReelMode = "all";

interface BasePoolActor {
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

export interface DailyReelActor extends BasePoolActor {
  tier: DailyReelTier;
}

export interface DailyReelMatchup {
  date: string;
  start: DailyReelActor;
  target: DailyReelActor;
  mode: DailyReelMode;
}

const EASTERN_TIMEZONE = "America/New_York";
const DAILY_REEL_EPOCH = "2026-06-10";

const RAW_TIERS = (poolData as {
  tiers: Record<DailyReelTier | "hard", BasePoolActor[]>;
}).tiers;

const DAILY_REEL_EASY_POOL: DailyReelActor[] = RAW_TIERS.easy.map((actor) => ({
  ...actor,
  tier: "easy" as const,
}));

const DAILY_REEL_MEDIUM_POOL: DailyReelActor[] = RAW_TIERS.medium.map((actor) => ({
  ...actor,
  tier: "medium" as const,
}));

const DAILY_REEL_PATTERN = ["easy-easy", "easy-easy", "easy-easy", "easy-medium"] as const;
type DailyReelPatternEntry = (typeof DAILY_REEL_PATTERN)[number];

function hash(input: string): number {
  let value = 2166136261;
  for (let i = 0; i < input.length; i++) {
    value ^= input.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function stableSortByHash<T>(items: T[], key: (item: T) => string): T[] {
  return [...items].sort((a, b) => {
    const aHash = hash(key(a));
    const bHash = hash(key(b));
    if (aHash !== bHash) return aHash - bHash;
    return key(a).localeCompare(key(b));
  });
}

// Pairing avoids a shared *movie* so the start/target aren't trivially one move
// apart. TV credits are intentionally excluded here: the pool's tvIds are
// dominated by talk/variety shows (e.g. SNL appears for most actors), which
// would make almost every pair look "connected" and starve the scheduler.
function sharesMovie(a: DailyReelActor, b: DailyReelActor): boolean {
  const movieIds = new Set(a.movieIds);
  return b.movieIds.some((movieId) => movieIds.has(movieId));
}

function buildInterleavedOrder(actors: DailyReelActor[]): DailyReelActor[] {
  const buckets = new Map<string, DailyReelActor[]>();

  for (const actor of actors) {
    const bucketKey = `${actor.tier}:${actor.ethnicityTag}`;
    const bucket = buckets.get(bucketKey) ?? [];
    bucket.push(actor);
    buckets.set(bucketKey, bucket);
  }

  const entries = [...buckets.entries()]
    .sort((a, b) => {
      if (b[1].length !== a[1].length) return b[1].length - a[1].length;
      return a[0].localeCompare(b[0]);
    })
    .map(([bucketKey, actors]) => ({
      bucketKey,
      actors: stableSortByHash(actors, (actor) => `${bucketKey}:${actor.id}:${actor.name}`),
    }));

  const interleaved: DailyReelActor[] = [];
  let remaining = entries.reduce((sum, entry) => sum + entry.actors.length, 0);
  let round = 0;

  while (remaining > 0) {
    for (const entry of entries) {
      const actor = entry.actors[round];
      if (!actor) continue;
      interleaved.push(actor);
      remaining -= 1;
    }
    round += 1;
  }

  return interleaved;
}

function pairKey(a: DailyReelActor, b: DailyReelActor): string {
  return a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
}

function findCandidate(
  actor: DailyReelActor,
  order: DailyReelActor[],
  startIndex: number,
  usedPairs: Set<string>
): { actor: DailyReelActor; nextIndex: number } | null {
  let fallback: { actor: DailyReelActor; nextIndex: number } | null = null;

  for (let offset = 0; offset < order.length; offset++) {
    const index = (startIndex + offset) % order.length;
    const candidate = order[index];

    if (candidate.id === actor.id || sharesMovie(actor, candidate)) continue;

    const result = {
      actor: candidate,
      nextIndex: (index + 1) % order.length,
    };

    if (!usedPairs.has(pairKey(actor, candidate))) return result;
    fallback ??= result;
  }

  return fallback;
}

function buildCycle(): DailyReelActor[][] {
  const easyOrder = buildInterleavedOrder(DAILY_REEL_EASY_POOL);
  const mediumOrder = buildInterleavedOrder(DAILY_REEL_MEDIUM_POOL);
  const pairs: DailyReelActor[][] = [];
  const usedPairs = new Set<string>();
  const cycleLength = mediumOrder.length * DAILY_REEL_PATTERN.length;
  let easyIndex = 0;
  let mediumIndex = 0;

  for (let day = 0; day < cycleLength; day++) {
    const pattern = DAILY_REEL_PATTERN[day % DAILY_REEL_PATTERN.length] as DailyReelPatternEntry;

    if (pattern === "easy-easy") {
      const start = easyOrder[easyIndex];
      easyIndex = (easyIndex + 1) % easyOrder.length;

      const partner = findCandidate(start, easyOrder, easyIndex, usedPairs);
      if (!partner) {
        throw new Error(`Daily Reel scheduling could not find an easy partner for ${start.name}.`);
      }

      easyIndex = partner.nextIndex;
      usedPairs.add(pairKey(start, partner.actor));
      pairs.push([start, partner.actor]);
      continue;
    }

    const start = easyOrder[easyIndex];
    easyIndex = (easyIndex + 1) % easyOrder.length;

    const partner = findCandidate(start, mediumOrder, mediumIndex, usedPairs);
    if (!partner) {
      throw new Error(`Daily Reel scheduling could not find a medium partner for ${start.name}.`);
    }

    mediumIndex = partner.nextIndex;
    usedPairs.add(pairKey(start, partner.actor));
    pairs.push([start, partner.actor]);
  }

  return pairs;
}

const DAILY_REEL_CYCLE = buildCycle();
export const DAILY_REEL_CYCLE_LENGTH = DAILY_REEL_CYCLE.length;

function parseDateKey(dateKey: string): { year: number; month: number; day: number } {
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`Invalid date key "${dateKey}". Expected YYYY-MM-DD.`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcDate = new Date(Date.UTC(year, month - 1, day));

  if (
    utcDate.getUTCFullYear() !== year ||
    utcDate.getUTCMonth() !== month - 1 ||
    utcDate.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date "${dateKey}".`);
  }

  return { year, month, day };
}

function dateKeyToUtcDay(dateKey: string): number {
  const { year, month, day } = parseDateKey(dateKey);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function positiveModulo(value: number, mod: number): number {
  return ((value % mod) + mod) % mod;
}

export function getEasternDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: EASTERN_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("Failed to derive the current Eastern date.");
  }

  return `${year}-${month}-${day}`;
}

export function getDailyReel(dateKey: string): DailyReelMatchup {
  const offsetDays = dateKeyToUtcDay(dateKey) - dateKeyToUtcDay(DAILY_REEL_EPOCH);
  const pairIndex = positiveModulo(offsetDays, DAILY_REEL_CYCLE_LENGTH);
  const [start, target] = DAILY_REEL_CYCLE[pairIndex];

  return {
    date: dateKey,
    start,
    target,
    mode: "all",
  };
}

export function getTodayDailyReel(now = new Date()): DailyReelMatchup {
  return getDailyReel(getEasternDateKey(now));
}
