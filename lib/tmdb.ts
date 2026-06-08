// Server-side TMDB client. The API key never reaches the browser.
const BASE = "https://api.themoviedb.org/3";

export interface CreditTitle {
  id: number;
  title: string; // normalized display title (movie title or TV name)
  year: string | null;
  mediaType: "movie" | "tv";
  character?: string;
  voteCount: number; // popularity proxy, used to surface well-known titles in hints
  originalLanguage: string; // e.g. "en" — used to restrict to Hollywood titles
}

export interface CastMember {
  id: number;
  name: string;
  character?: string;
  profilePath: string | null;
  order: number; // billing order; lower = more prominent
}

export interface PersonLite {
  id: number;
  name: string;
  profilePath: string | null;
  knownFor: string;
  // Recognizability proxy: vote count of the person's most-rated ENGLISH-language
  // credit. ~free (known_for is already in the /person/popular payload). Using the
  // English peak biases toward actors a Western/English-speaking player would know,
  // and the magnitude separates superstars from C-listers.
  famePeak?: number;
}

export interface TitleLite {
  id: number;
  title: string;
  year: string | null;
  mediaType: "movie" | "tv";
}

const GLOBAL_MOVIE_RECOGNITION_FLOOR = 2500;

function key(): string {
  const k = process.env.TMDB_API_KEY;
  if (!k) {
    throw new Error(
      "TMDB_API_KEY is not set. Create a .env.local file with TMDB_API_KEY=... (see README)."
    );
  }
  return k;
}

async function tmdb<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(BASE + path);
  url.searchParams.set("api_key", key());
  url.searchParams.set("language", "en-US");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  // Cache responses for an hour — credit data is effectively static.
  const res = await fetch(url.toString(), { next: { revalidate: 3600 } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`TMDB ${res.status} on ${path}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export async function searchPerson(query: string): Promise<PersonLite[]> {
  const data = await tmdb<{ results: any[] }>("/search/person", {
    query,
    include_adult: "false"
  });
  return (data.results || []).slice(0, 8).map((p) => ({
    id: p.id,
    name: p.name,
    profilePath: p.profile_path ?? null,
    knownFor: (p.known_for || [])
      .map((k: any) => k.title || k.name)
      .filter(Boolean)
      .slice(0, 3)
      .join(", ")
  }));
}

// Popular actors by page. Page 1 is the most famous people on TMDB; deeper pages
// are progressively more obscure — that's how difficulty modes get harder.
export async function getPopularPeople(page: number): Promise<PersonLite[]> {
  const data = await tmdb<{ results: any[] }>("/person/popular", { page: String(page) });
  return (data.results || [])
    .filter(
      (p) =>
        !p.adult && // TMDB's `adult` flag only catches hardcore, not softcore
        p.known_for_department === "Acting" &&
        p.profile_path && // real, recognizable people have a photo
        // Require a genuinely-rated credit. Softcore/erotic titles (which TMDB
        // doesn't flag as adult) have near-zero votes; real films clear this easily.
        (p.known_for || []).some(
          (k: any) => !k.adult && (k.title || k.name) && (k.vote_count || 0) >= 30
        )
    )
    .map((p) => {
      const known = (p.known_for || []).filter((k: any) => !k.adult && (k.title || k.name));
      const english = known.filter((k: any) => k.original_language === "en");
      return {
        id: p.id,
        name: p.name,
        profilePath: p.profile_path ?? null,
        famePeak: english.reduce((m: number, k: any) => Math.max(m, k.vote_count || 0), 0),
        knownFor: [...known]
          .sort((a: any, b: any) => (b.vote_count || 0) - (a.vote_count || 0))
          .map((k: any) => k.title || k.name)
          .slice(0, 3)
          .join(", ")
      };
    });
}

// Global movie/TV title search — used for the title autocomplete. Intentionally
// NOT filtered to the current actor, so it helps spelling without revealing which
// titles the actor is actually in.
export async function searchTitles(
  query: string,
  mode: "movie" | "all" = "all"
): Promise<TitleLite[]> {
  const data = await tmdb<{ results: any[] }>("/search/multi", {
    query,
    include_adult: "false"
  });
  return (data.results || [])
    .filter(
      (r) =>
        (
          r.original_language === "en" ||
          (r.media_type === "movie" && (r.vote_count ?? 0) >= GLOBAL_MOVIE_RECOGNITION_FLOOR)
        ) &&
        (r.media_type === "movie" || (mode === "all" && r.media_type === "tv"))
    )
    .map((r) => {
      const date: string = r.release_date || r.first_air_date || "";
      return {
        id: r.id,
        title: (r.title || r.name || "").trim(),
        year: date ? date.slice(0, 4) : null,
        mediaType: r.media_type as "movie" | "tv",
        popularity: r.popularity ?? 0
      };
    })
    .filter((t) => t.title.length > 0)
    .sort((a, b) => b.popularity - a.popularity)
    .slice(0, 8)
    .map(({ popularity, ...rest }) => rest);
}

export async function getPerson(id: number): Promise<PersonLite | null> {
  try {
    const p = await tmdb<any>(`/person/${id}`);
    return { id: p.id, name: p.name, profilePath: p.profile_path ?? null, knownFor: "" };
  } catch {
    return null;
  }
}

// All acting credits for a person, as a flat list of titles.
export async function getActingCredits(personId: number): Promise<CreditTitle[]> {
  const data = await tmdb<{ cast: any[] }>(`/person/${personId}/combined_credits`);
  return (data.cast || [])
    .filter((c) => c.media_type === "movie" || c.media_type === "tv")
    .map((c) => {
      const date: string = c.release_date || c.first_air_date || "";
      return {
        id: c.id,
        title: (c.title || c.name || "").trim(),
        year: date ? date.slice(0, 4) : null,
        mediaType: c.media_type as "movie" | "tv",
        character: c.character,
        voteCount: c.vote_count ?? 0,
        originalLanguage: c.original_language ?? ""
      };
    })
    .filter((c) => c.title.length > 0);
}

// Full cast of a movie or TV title.
export async function getTitleCast(
  id: number,
  mediaType: "movie" | "tv"
): Promise<CastMember[]> {
  if (mediaType === "tv") {
    const data = await tmdb<{ cast: any[]; guest_stars?: any[] }>(`/tv/${id}/aggregate_credits`);
    return (data.cast || []).map((c, i) => ({
      id: c.id,
      name: c.name,
      character: (c.roles && c.roles[0]?.character) || undefined,
      profilePath: c.profile_path ?? null,
      order: c.order ?? i
    }));
  }
  const data = await tmdb<{ cast: any[] }>(`/movie/${id}/credits`);
  return (data.cast || []).map((c, i) => ({
    id: c.id,
    name: c.name,
    character: c.character,
    profilePath: c.profile_path ?? null,
    order: c.order ?? i
  }));
}

// Worldwide box-office gross for a movie (0 for TV or when TMDB has no data).
export async function getMovieRevenue(
  id: number,
  mediaType: "movie" | "tv"
): Promise<number> {
  if (mediaType !== "movie") return 0;
  try {
    const d = await tmdb<{ revenue?: number }>(`/movie/${id}`);
    return d.revenue || 0;
  } catch {
    return 0;
  }
}
