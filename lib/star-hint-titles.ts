export interface HintTitleCredit {
  id: number;
  mediaType: "movie" | "tv";
  originalLanguage: string;
  posterPath: string | null;
  releaseDate: string | null;
  title: string;
  voteCount: number;
  year: string | null;
}

export interface HintTitle {
  id: number;
  name: string;
  year: string | null;
  posterPath: string | null;
}

export interface HintTitlePick {
  titles: HintTitle[];
  remainingTitles: number;
}

export type HintTitleMode = "movie" | "all";

const GLOBAL_MOVIE_RECOGNITION_FLOOR = 2500;

function isHollywoodCredit(credit: HintTitleCredit): boolean {
  return credit.originalLanguage === "en";
}

function isGloballyRecognizableForeignMovie(credit: HintTitleCredit): boolean {
  return (
    credit.mediaType === "movie" &&
    credit.originalLanguage !== "en" &&
    credit.voteCount >= GLOBAL_MOVIE_RECOGNITION_FLOOR
  );
}

function inMode(credits: HintTitleCredit[], mode: HintTitleMode): HintTitleCredit[] {
  return credits.filter((credit) => {
    if (!isHollywoodCredit(credit) && !isGloballyRecognizableForeignMovie(credit)) return false;
    return mode === "movie" ? credit.mediaType === "movie" : true;
  });
}

function isReleased(credit: HintTitleCredit): boolean {
  if (!credit.releaseDate) return true;
  const released = Date.parse(credit.releaseDate);
  if (Number.isNaN(released)) return true;
  return released <= Date.now();
}

function compareHintTitles(a: HintTitleCredit, b: HintTitleCredit): number {
  if (a.mediaType !== b.mediaType) return a.mediaType === "movie" ? -1 : 1;
  if (b.voteCount !== a.voteCount) return b.voteCount - a.voteCount;
  if ((b.releaseDate ?? "") !== (a.releaseDate ?? "")) {
    return (b.releaseDate ?? "").localeCompare(a.releaseDate ?? "");
  }
  const titleDiff = a.title.localeCompare(b.title);
  if (titleDiff !== 0) return titleDiff;
  return a.id - b.id;
}

export function listStarHintTitles(
  credits: HintTitleCredit[],
  mode: HintTitleMode,
  limit = 3
): HintTitle[] {
  return [...inMode(credits, mode)]
    .filter(isReleased)
    .sort(compareHintTitles)
    .slice(0, limit)
    .map((credit) => ({
      id: credit.id,
      name: credit.title,
      year: credit.year,
      posterPath: credit.posterPath ?? null,
    }));
}

export function pickNextStarHintTitle(
  titles: HintTitle[],
  excludeTitleIds: number[] = []
): HintTitlePick {
  const excluded = new Set(excludeTitleIds);
  const remaining = titles.filter((title) => !excluded.has(title.id));
  return {
    titles: remaining.slice(0, 1),
    remainingTitles: Math.max(0, remaining.length - 1),
  };
}
