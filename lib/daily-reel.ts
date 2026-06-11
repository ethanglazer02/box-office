import poolData from "./actor-pool.json" with { type: "json" };

export type DailyReelTier = "easy" | "medium";
export type DailyReelMode = "movie";

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

const DAILY_REEL_POOL: DailyReelActor[] = [
  ...RAW_TIERS.easy.map((actor) => ({ ...actor, tier: "easy" as const })),
  ...RAW_TIERS.medium.map((actor) => ({ ...actor, tier: "medium" as const })),
];

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

function sharesMovie(a: DailyReelActor, b: DailyReelActor): boolean {
  const movieIds = new Set(a.movieIds);
  return b.movieIds.some((movieId) => movieIds.has(movieId));
}

function buildInterleavedOrder(): DailyReelActor[] {
  const buckets = new Map<string, DailyReelActor[]>();

  for (const actor of DAILY_REEL_POOL) {
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

function findPartnerIndex(actor: DailyReelActor, queue: DailyReelActor[]): number {
  let sameTierIndex = -1;

  for (let index = 0; index < queue.length; index++) {
    const candidate = queue[index];
    if (sharesMovie(actor, candidate)) continue;
    if (candidate.tier !== actor.tier) return index;
    if (sameTierIndex === -1) sameTierIndex = index;
  }

  return sameTierIndex;
}

function buildCycle(): DailyReelActor[][] {
  const queue = [...buildInterleavedOrder()];
  const pairs: DailyReelActor[][] = [];
  let stalled = 0;

  while (queue.length >= 2) {
    const actor = queue.shift()!;
    const partnerIndex = findPartnerIndex(actor, queue);

    if (partnerIndex === -1) {
      queue.push(actor);
      stalled += 1;
      if (stalled > queue.length * 4) {
        throw new Error(`Daily Reel scheduling stalled with ${queue.length} actors remaining.`);
      }
      continue;
    }

    stalled = 0;
    const [partner] = queue.splice(partnerIndex, 1);
    pairs.push([actor, partner]);
  }

  if (queue.length > 0) {
    throw new Error("Daily Reel scheduling left an unpaired actor in the cycle.");
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
    mode: "movie",
  };
}

export function getTodayDailyReel(now = new Date()): DailyReelMatchup {
  return getDailyReel(getEasternDateKey(now));
}
