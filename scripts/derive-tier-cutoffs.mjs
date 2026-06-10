// Derives ABSOLUTE recognizability cutoffs for each tier from the actors already
// in lib/actor-pool.json, and writes them to lib/tier-cutoffs.json.
//
// Why this exists: the pool tiers were assigned by *percentile* rank across the
// offline corpus, which can't be evaluated for a single actor fetched live. To
// admit new actors at runtime WITHOUT letting difficulty drift toward obscurity,
// we need an absolute fame floor: "an actor is only acceptable for tier T if their
// raw familiarity F clears T's floor and their star power S sits in T's band."
//
// Scoring here is self-contained per actor (their own English movie credits),
// using the SAME primitives as build-actor-pool.mjs, so the cutoffs and the live
// gate that will check new candidates are measured on one consistent scale.
//
// This does NOT change the pool or gameplay — it only emits thresholds.
// Run with: node scripts/derive-tier-cutoffs.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const POOL_FILE = path.join(ROOT, "lib", "actor-pool.json");
const OUT_FILE = path.join(ROOT, "lib", "tier-cutoffs.json");

const BASE = "https://api.themoviedb.org/3";

// ---- scoring config (mirrors build-actor-pool.mjs) --------------------------
const QUALIFY_VOTE_GTE = 200; // a credit only counts toward scores above this
const QUALIFY_MAX_ORDER = 15; // deeper billing = stunt/background -> not a face
const CONCURRENCY = 16;

const filmWeight = (voteCount) => Math.log10(Math.max(voteCount, 1));
const billing = (order) => Math.exp(-(order == null || order < 0 ? 50 : order) / 2.5);

// ---- api key (env or .env.local) --------------------------------------------
function loadApiKey() {
  if (process.env.TMDB_API_KEY) return process.env.TMDB_API_KEY;
  for (const f of [".env.local", ".env"]) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*TMDB_API_KEY\s*=\s*(.+?)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, "");
    }
  }
  throw new Error("TMDB_API_KEY not found in env or .env.local");
}
const API_KEY = loadApiKey();

async function tmdb(p, params = {}) {
  const url = new URL(BASE + p);
  url.searchParams.set("api_key", API_KEY);
  url.searchParams.set("language", "en-US");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    if (attempt === 3) throw new Error(`TMDB ${res.status} on ${p}`);
    await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// Raw star-power (S) and face-familiarity (F) from an actor's own English movie
// credits — the exact shape build-actor-pool.mjs uses, just sourced per person so
// it's replayable live for a single candidate.
async function scoreActor(id) {
  const data = await tmdb(`/person/${id}/movie_credits`).catch(() => null);
  let s = 0;
  let f = 0;
  let counted = 0;
  for (const c of data?.cast || []) {
    if (c.original_language !== "en") continue;
    if ((c.vote_count ?? 0) < QUALIFY_VOTE_GTE) continue;
    if ((c.order ?? 99) > QUALIFY_MAX_ORDER) continue;
    if ((c.character || "").toLowerCase().includes("voice)")) continue;
    const w = filmWeight(c.vote_count);
    f += w;
    s += w * billing(c.order ?? 99);
    counted++;
  }
  return { s, f, counted };
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function r2(n) {
  return Math.round(n * 100) / 100;
}

(async () => {
  const pool = JSON.parse(fs.readFileSync(POOL_FILE, "utf8"));
  const tiers = pool.tiers;
  const tierNames = ["easy", "medium", "hard"];

  const cutoffs = {};
  for (const tier of tierNames) {
    const actors = tiers[tier] || [];
    console.log(`[${tier}] scoring ${actors.length} actors...`);
    let done = 0;
    const scored = await mapLimit(actors, CONCURRENCY, async (a) => {
      const sc = await scoreActor(a.id);
      if (++done % 100 === 0) console.log(`  ${done}/${actors.length}`);
      return { name: a.name, ...sc };
    });

    // Drop actors we couldn't score (no qualifying English movie credits) so a
    // single empty fetch can't drag the floor to zero.
    const usable = scored.filter((x) => x.counted > 0);
    const fSorted = usable.map((x) => x.f).sort((x, y) => x - y);
    const sSorted = usable.map((x) => x.s).sort((x, y) => x - y);

    // p10 floor: "as strong as the weak end of this tier today" while staying
    // robust to a lone outlier. The S band keeps a tier's characteristic shape
    // (e.g. hard = high familiarity, modest star power).
    cutoffs[tier] = {
      n: usable.length,
      fFloor: r2(percentile(fSorted, 10)),
      fMedian: r2(percentile(fSorted, 50)),
      sFloor: r2(percentile(sSorted, 10)),
      sMedian: r2(percentile(sSorted, 50)),
      sCeil: r2(percentile(sSorted, 90)),
    };

    const weakest = [...usable].sort((a, b) => a.f - b.f).slice(0, 3).map((x) => x.name);
    console.log(
      `  fFloor=${cutoffs[tier].fFloor} fMedian=${cutoffs[tier].fMedian} ` +
        `sFloor=${cutoffs[tier].sFloor} sMedian=${cutoffs[tier].sMedian} sCeil=${cutoffs[tier].sCeil}`
    );
    console.log(`  weakest-familiarity examples: ${weakest.join(", ")}`);
  }

  const out = {
    generatedAt: new Date().toISOString(),
    note: "Absolute S/F gate for admitting live-fetched actors. See scripts/derive-tier-cutoffs.mjs.",
    scoring: { QUALIFY_VOTE_GTE, QUALIFY_MAX_ORDER },
    cutoffs,
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${path.relative(ROOT, OUT_FILE)}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
