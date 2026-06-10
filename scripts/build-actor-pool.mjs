// Generates lib/actor-pool.json: actors tiered into easy / medium / hard by
// *recognizability to an American audience*, plus gender + curated ethnicity tags
// so /api/start can pick diverse, non-repeating start/target pairs with zero
// network calls. Run with: npm run build:pool
//
// Tiering does NOT trust TMDB popularity (global + recency-biased). Instead it
// derives two scores from real on-screen film exposure (English-language / US
// releases, weighted by each film's vote_count):
//
//   StarPower S       = Σ log10(votes) · exp(-order / 2.5)   "did they LEAD big films?"
//   FaceFamiliarity F = Σ log10(votes)                       "have we SEEN the face a lot?"
//
// Tiers fall out of the gap between them (all percentile-ranked across the pool):
//   easy   = top-decile StarPower + broadly seen        (instantly nameable lead)
//   hard   = high familiarity, low star power            ("oh, that guy from that movie")
//   medium = recognizable, mid star power                (in between)
//
// Voice-only and deep-billed (stunt/background) credits are excluded so the
// "face" tiers stay about faces you'd actually recognize.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_FILE = path.join(ROOT, "lib", "actor-pool.json");
const TAGS_FILE = path.join(ROOT, "lib", "ethnicity-tags.json");

const BASE = "https://api.themoviedb.org/3";

// ---- config -----------------------------------------------------------------
const YEAR_MIN = 1980;
const YEAR_MAX = 2025;
const PAGES_PER_YEAR = 2; // ~20 films/page of top US/English releases per year
const DISCOVER_VOTE_GTE = 400; // a film must be genuinely well-rated to seed

const QUALIFY_VOTE_GTE = 200; // a credit only counts toward scores above this
const QUALIFY_MAX_ORDER = 15; // deeper billing = stunt/background -> not a face
const QUALIFY_MIN_CREDITS = 3; // drop noise

const CONCURRENCY = 16;

// Tier thresholds (percentiles 0-100). See header for rationale.
const EASY_S_PCT = 90;
const EASY_F_PCT = 70;
const HARD_F_PCT = 70;
const HARD_S_PCT_MAX = 50;
const HARD_GAP_MIN = 15;
const HARD_P_PCT_MIN = 30; // floor (not a gate): excludes near-zero-pop crew/extras
const MEDIUM_F_PCT = 55;
const MEDIUM_S_PCT_MIN = 40;
const MEDIUM_S_PCT_MAX = 90;

// ---- scoring primitives -----------------------------------------------------
const filmWeight = (voteCount) => Math.log10(Math.max(voteCount, 1));
// Leadness: order 0 -> 1.0, 2 -> 0.45, 5 -> 0.14, 10 -> 0.018. Keeps prolific
// supporting players OUT of the star tier while their familiarity stays high.
const billing = (order) => Math.exp(-(order == null || order < 0 ? 50 : order) / 2.5);

// Country (as it ends a TMDB place_of_birth) -> proxy ethnicity. Neutral buckets
// (US/UK/Anglo "Unknown") intentionally do NOT assert race where nationality is
// itself diverse; the curated layer is what guarantees race coverage there.
const COUNTRY_PROXY = {
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

function proxyFromPlaceOfBirth(pob) {
  if (!pob) return "Unspecified";
  const country = pob.split(",").pop().trim();
  return COUNTRY_PROXY[country] || "Unspecified";
}

// Map each value to its percentile (0-100) via average rank (ties share a rank).
function percentileRanks(values) {
  const n = values.length;
  if (n === 0) return [];
  const order = [...values.keys()].sort((a, b) => values[a] - values[b]);
  const out = new Array(n).fill(0);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && values[order[j + 1]] === values[order[i]]) j++;
    const avgPos = (i + j) / 2 + 1; // 1-based
    const pct = (100 * (avgPos - 0.5)) / n;
    for (let k = i; k <= j; k++) out[order[k]] = pct;
    i = j + 1;
  }
  return out;
}

// ---- api key ----------------------------------------------------------------
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

// ---- pipeline ---------------------------------------------------------------
// 1. Seed: top US/English films per year (Animation excluded: its cast is voice).
async function seedFilms() {
  const filmVotes = new Map(); // movieId -> voteCount
  const years = Array.from({ length: YEAR_MAX - YEAR_MIN + 1 }, (_, k) => YEAR_MIN + k);
  await mapLimit(years, CONCURRENCY, async (year) => {
    for (let page = 1; page <= PAGES_PER_YEAR; page++) {
      const data = await tmdb("/discover/movie", {
        include_adult: false,
        include_video: false,
        with_original_language: "en",
        primary_release_year: year,
        sort_by: "vote_count.desc",
        "vote_count.gte": DISCOVER_VOTE_GTE,
        without_genres: "16",
        page,
      }).catch(() => null);
      for (const m of data?.results || []) filmVotes.set(m.id, m.vote_count || 0);
    }
  });
  return filmVotes;
}

// 2. Aggregate cast credits per person (on-screen, billed roles only).
async function aggregatePeople(filmVotes) {
  const people = new Map();
  const ids = [...filmVotes.keys()];
  let done = 0;
  await mapLimit(ids, CONCURRENCY, async (movieId) => {
    const voteCount = filmVotes.get(movieId);
    if (voteCount < QUALIFY_VOTE_GTE) return;
    const credits = await tmdb(`/movie/${movieId}/credits`).catch(() => null);
    if (++done % 200 === 0) console.log(`  credits ${done}/${ids.length}`);
    for (const c of credits?.cast || []) {
      if (c.known_for_department !== "Acting" || !c.profile_path || c.adult) continue;
      if ((c.order ?? 99) > QUALIFY_MAX_ORDER) continue;
      const character = (c.character || "").toLowerCase();
      if (character.includes("voice)")) continue; // (voice) / uncredited voice roles
      let a = people.get(c.id);
      if (!a) {
        a = {
          id: c.id,
          name: c.name,
          profilePath: c.profile_path,
          gender: c.gender ?? 0,
          popularity: 0,
          credits: [],
        };
        people.set(c.id, a);
      }
      a.credits.push({ voteCount, order: c.order ?? 99 });
      a.popularity = Math.max(a.popularity, c.popularity || 0);
    }
  });
  return [...people.values()];
}

// 3. Score, percentile-rank, classify.
function scoreAndClassify(people) {
  for (const p of people) {
    let s = 0, f = 0;
    for (const c of p.credits) {
      const w = filmWeight(c.voteCount);
      f += w;
      s += w * billing(c.order);
    }
    p.S = s;
    p.F = f;
  }
  people = people.filter((p) => p.credits.length >= QUALIFY_MIN_CREDITS);

  const sP = percentileRanks(people.map((p) => p.S));
  const fP = percentileRanks(people.map((p) => p.F));
  const pP = percentileRanks(people.map((p) => p.popularity));
  people.forEach((p, i) => {
    p.sPct = sP[i];
    p.fPct = fP[i];
    p.pPct = pP[i];
    p.gap = fP[i] - sP[i];
  });

  for (const p of people) {
    if (p.sPct >= EASY_S_PCT && p.fPct >= EASY_F_PCT) p.tier = "easy";
    else if (p.fPct >= HARD_F_PCT && p.sPct <= HARD_S_PCT_MAX && p.gap >= HARD_GAP_MIN && p.pPct >= HARD_P_PCT_MIN) p.tier = "hard";
    else if (p.fPct >= MEDIUM_F_PCT && p.sPct >= MEDIUM_S_PCT_MIN && p.sPct < MEDIUM_S_PCT_MAX) p.tier = "medium";
    else p.tier = null;
  }
  return people.filter((p) => p.tier);
}

// 4. Enrich tiered actors: place_of_birth (ethnicity proxy), known-for titles,
//    and precomputed English movie/TV ids for instant pair validation in /api/start.
async function enrich(people, curated) {
  let done = 0;
  await mapLimit(people, CONCURRENCY, async (p) => {
    const d = await tmdb(`/person/${p.id}`, { append_to_response: "combined_credits" }).catch(() => null);
    if (++done % 200 === 0) console.log(`  enrich ${done}/${people.length}`);

    const entry = curated[String(p.id)];
    if (entry?.name && d?.name && entry.name.toLowerCase() !== d.name.toLowerCase()) {
      console.warn(`  WARN curated id ${p.id} expected "${entry.name}" but TMDB says "${d.name}"`);
    }
    p.ethnicityTag = entry ? entry.tag : proxyFromPlaceOfBirth(d?.place_of_birth);

    const cast = d?.combined_credits?.cast || [];
    const movieIds = [];
    const tvIds = [];
    const englishMovies = [];
    for (const c of cast) {
      if (c.original_language !== "en") continue;
      if (c.media_type === "movie") {
        movieIds.push(c.id);
        englishMovies.push({ title: c.title || "", voteCount: c.vote_count || 0 });
      } else if (c.media_type === "tv") {
        tvIds.push(c.id);
      }
    }
    p.movieIds = [...new Set(movieIds)];
    p.tvIds = [...new Set(tvIds)];
    p.knownFor = englishMovies
      .sort((a, b) => b.voteCount - a.voteCount)
      .map((m) => m.title)
      .filter(Boolean)
      .slice(0, 3)
      .join(", ");
  });
}

function toEntry(p) {
  return {
    id: p.id,
    name: p.name,
    profilePath: p.profilePath,
    knownFor: p.knownFor || "",
    gender: p.gender,
    ethnicityTag: p.ethnicityTag,
    movieIds: p.movieIds,
    tvIds: p.tvIds,
    scores: {
      sPct: Math.round(p.sPct),
      fPct: Math.round(p.fPct),
      pPct: Math.round(p.pPct),
      gap: Math.round(p.gap),
    },
  };
}

function summarize(list) {
  const g = { 1: 0, 2: 0, 3: 0, 0: 0 };
  const tags = {};
  for (const a of list) {
    g[a.gender] = (g[a.gender] || 0) + 1;
    tags[a.ethnicityTag] = (tags[a.ethnicityTag] || 0) + 1;
  }
  const nonmale = (g[1] || 0) + (g[3] || 0);
  const pct = list.length ? Math.round((100 * nonmale) / list.length) : 0;
  return { nonmalePct: pct, genders: g, tags };
}

(async () => {
  const curated = JSON.parse(fs.readFileSync(TAGS_FILE, "utf8")).tags;

  console.log(`[1/4] Seeding films ${YEAR_MIN}-${YEAR_MAX}...`);
  const filmVotes = await seedFilms();
  console.log(`  ${filmVotes.size} seed films`);

  console.log("[2/4] Aggregating cast credits...");
  let people = await aggregatePeople(filmVotes);
  console.log(`  ${people.length} raw candidates`);

  console.log("[3/4] Scoring + classifying...");
  people = scoreAndClassify(people);
  console.log(`  ${people.length} tiered candidates`);

  console.log("[4/4] Enriching (ethnicity, known-for, credit ids)...");
  await enrich(people, curated);

  const tiers = { easy: [], medium: [], hard: [] };
  for (const p of people) tiers[p.tier].push(toEntry(p));
  for (const t of ["easy", "medium", "hard"]) {
    tiers[t].sort((a, b) => b.scores.fPct - a.scores.fPct);
  }

  const out = { generatedAt: new Date().toISOString(), tiers };
  fs.writeFileSync(OUT_FILE, JSON.stringify(out));

  console.log("\nWrote", path.relative(ROOT, OUT_FILE));
  for (const t of ["easy", "medium", "hard"]) {
    const s = summarize(tiers[t]);
    console.log(
      `  ${t}: ${tiers[t].length} actors | non-male ${s.nonmalePct}% | ${JSON.stringify(s.tags)}`
    );
    console.log(`     e.g. ${tiers[t].slice(0, 6).map((a) => a.name).join(", ")}`);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
