import {
  getActingCredits,
  getTitleCast,
  getTitleValue,
  CreditTitle,
  CastMember
} from "./tmdb";

// "movie" = films only; "all" = films + TV.
export type Mode = "movie" | "all";

const GLOBAL_MOVIE_RECOGNITION_FLOOR = 2500;

function isHollywoodCredit(credit: CreditTitle): boolean {
  return credit.originalLanguage === "en";
}

function isGloballyRecognizableForeignMovie(credit: CreditTitle): boolean {
  return (
    credit.mediaType === "movie" &&
    credit.originalLanguage !== "en" &&
    credit.voteCount >= GLOBAL_MOVIE_RECOGNITION_FLOOR
  );
}

// TMDB does not expose a literal "Hollywood" flag, so gameplay uses a hybrid rule:
// English-language titles are always allowed, and famous foreign-language movies
// are also allowed when they clear a strong recognizability threshold.
function inMode(credits: CreditTitle[], mode: Mode): CreditTitle[] {
  return credits.filter((credit) => {
    if (!isHollywoodCredit(credit) && !isGloballyRecognizableForeignMovie(credit)) return false;
    return mode === "movie" ? credit.mediaType === "movie" : true;
  });
}

// Normalize titles/names for forgiving comparison:
// lowercase, strip accents, drop punctuation, collapse whitespace,
// and drop a leading article ("the", "a", "an").
export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleMatches(typed: string, candidate: string): boolean {
  const a = normalize(typed);
  const b = normalize(candidate);
  if (!a || !b) return false;
  if (a === b) return true;
  // Allow a containment match only when the two are close in length, so typing
  // "Breaking Bad" doesn't match "...Creating the Final Season of Breaking Bad".
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return long.includes(short) && short.length / long.length >= 0.6;
}

function nameMatches(typed: string, candidate: string): boolean {
  const a = normalize(typed);
  const b = normalize(candidate);
  if (!a || !b) return false;
  if (a === b) return true;
  // Allow last-name-only / partial matches, but require a meaningful token.
  if (a.length >= 3 && (b.includes(a) || a.includes(b))) return true;
  return false;
}

export interface GuessResult {
  valid: boolean;
  message: string;
  won?: boolean;
  // On a valid guess, the co-star becomes the new current actor.
  newActor?: { id: number; name: string; profilePath: string | null };
  // The verified title used to make the connection.
  title?: { id: number; name: string; year: string | null; revenue: number; posterPath: string | null };
}

/**
 * Validate one move in the chain.
 *
 * The clever bit: we confirm "current actor is in this movie" by searching the
 * actor's OWN credit list for the typed title. That gives us the exact title id
 * with zero ambiguity, and proves the actor is credited. We then pull that
 * title's full cast and confirm the typed co-star is also credited.
 */
export async function validateGuess(params: {
  currentActorId: number;
  targetActorId: number;
  movieTitle: string;
  costarName: string;
  mode: Mode;
}): Promise<GuessResult> {
  const { currentActorId, targetActorId, movieTitle, costarName, mode } = params;

  if (!movieTitle.trim() || !costarName.trim()) {
    return { valid: false, message: "Enter both a title and a co-star." };
  }

  const credits = inMode(await getActingCredits(currentActorId), mode);

  // All of the current actor's titles whose name matches what they typed.
  const matches: CreditTitle[] = credits.filter((c) => titleMatches(movieTitle, c.title));

  if (matches.length === 0) {
    return {
      valid: false,
      message:
        mode === "movie"
          ? `Couldn't find the movie "${movieTitle}" for that actor. (Movies-only mode — TV doesn't count.) Check the spelling, or try another.`
          : `Couldn't find "${movieTitle}" in that actor's filmography. Check the spelling, or try another title.`
    };
  }

  // Prefer exact normalized matches, then check up to a handful of candidates
  // (covers remakes / same-named titles). Most-credited titles first.
  const exact = matches.filter((c) => normalize(c.title) === normalize(movieTitle));
  const candidates = (exact.length ? exact : matches).slice(0, 6);

  for (const cand of candidates) {
    const cast: CastMember[] = await getTitleCast(cand.id, cand.mediaType);

    // Can't be your own co-star.
    const costar = cast.find(
      (m) => m.id !== currentActorId && nameMatches(costarName, m.name)
    );
    if (!costar) continue;

    const won = costar.id === targetActorId;
    const revenue = await getTitleValue(cand.id, cand.mediaType);
      return {
        valid: true,
        won,
        message: won
          ? `🎉 Connected! ${costar.name} is the target — you linked them in ${cand.title}.`
          : `✓ Verified: ${costar.name} appears in ${cand.title}${cand.year ? ` (${cand.year})` : ""}.`,
        newActor: { id: costar.id, name: costar.name, profilePath: costar.profilePath },
        title: {
          id: cand.id,
          name: cand.title,
          year: cand.year,
          revenue,
          posterPath: cand.posterPath,
        }
      };
  }

  return {
    valid: false,
    message: `Found "${candidates[0].title}", but "${costarName}" isn't in its cast. Different co-star?`
  };
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export interface HintResult {
  ok: boolean;
  message: string;
  // The value to drop into the corresponding input field.
  fill?: string;
  actorId?: number;
}

// Movie hint: surface a real, well-known title the current actor is in.
export async function movieHint(currentActorId: number, mode: Mode): Promise<HintResult> {
  const credits = inMode(await getActingCredits(currentActorId), mode);
  if (credits.length === 0) {
    return { ok: false, message: "No qualifying titles found for that actor." };
  }
  // Favor recognizable titles, but pick randomly among the top so hints vary.
  const ranked = [...credits].sort((a, b) => b.voteCount - a.voteCount);
  const pool = ranked.slice(0, Math.min(12, ranked.length));
  const pick = pickRandom(pool);
  return {
    ok: true,
    fill: pick.title,
    message: `💡 Try "${pick.title}"${pick.year ? ` (${pick.year})` : ""}.`
  };
}

// Co-star hint: reveal an actor from the movie the player has entered.
// Requires a title the current actor is actually in.
export async function actorHint(
  currentActorId: number,
  movieTitle: string,
  mode: Mode,
  excludeActorIds: number[] = []
): Promise<HintResult> {
  if (!movieTitle.trim()) {
    return { ok: false, message: "Fill in a movie first to get a co-star hint." };
  }
  const credits = inMode(await getActingCredits(currentActorId), mode);
  const matches = credits.filter((c) => titleMatches(movieTitle, c.title));
  if (matches.length === 0) {
    return {
      ok: false,
      message: `"${movieTitle}" isn't in that actor's filmography — enter a valid title first.`
    };
  }
  const exact = matches.filter((c) => normalize(c.title) === normalize(movieTitle));
  const candidates = (exact.length ? exact : matches).slice(0, 4);

  const excluded = new Set(excludeActorIds);
  for (const cand of candidates) {
    const cast: CastMember[] = await getTitleCast(cand.id, cand.mediaType);
    const pick = cast
      .filter((m) => m.id !== currentActorId && m.name)
      .sort((a, b) => a.order - b.order)
      .find((member) => !excluded.has(member.id));
    if (!pick) continue;

    return {
      ok: true,
      fill: pick.name,
      actorId: pick.id,
      message: `💡 ${pick.name} is in "${cand.title}".`
    };
  }
  if (excludeActorIds.length > 0) {
    return { ok: false, message: `No more co-star hints left for "${movieTitle}".` };
  }
  return { ok: false, message: `Couldn't pull a cast list for "${movieTitle}".` };
}
