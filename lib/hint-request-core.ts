interface HintResult {
  ok: boolean;
  message: string;
  fill?: string;
  actorId?: number;
  remainingTitles?: number;
  titles?: Array<{ id: number; name: string; year: string | null; posterPath: string | null }>;
}

interface HintRequestBody {
  actorId?: unknown;
  currentActorId?: unknown;
  excludeActorIds?: unknown;
  excludeTitleIds?: unknown;
  mode?: unknown;
  movieTitle?: unknown;
  type?: unknown;
}

interface HintResponse {
  result: HintResult;
  status: number;
}

type HintMode = "movie" | "all";

interface HintDeps {
  actorHint: (
    currentActorId: number,
    movieTitle: string,
    mode: HintMode,
    excludeActorIds: number[]
  ) => Promise<HintResult>;
  movieHint: (currentActorId: number, mode: HintMode) => Promise<HintResult>;
  starTitlesHint: (actorId: number, mode: HintMode, excludeTitleIds: number[]) => Promise<HintResult>;
}

function readMode(raw: unknown): HintMode {
  return raw === "movie" ? "movie" : "all";
}

function readExcludeActorIds(raw: unknown): number[] {
  return Array.isArray(raw) ? raw.map((value) => Number(value)).filter(Boolean) : [];
}

export async function resolveHintRequest(
  body: HintRequestBody,
  deps: HintDeps
): Promise<HintResponse> {
  const type = String(body.type);
  const mode = readMode(body.mode);

  if (type === "star-titles") {
    const actorId = Number(body.actorId);
    if (!actorId) {
      return { result: { ok: false, message: "Missing actor id." }, status: 400 };
    }

    return {
      result: await deps.starTitlesHint(actorId, mode, readExcludeActorIds(body.excludeTitleIds)),
      status: 200,
    };
  }

  const currentActorId = Number(body.currentActorId);
  if (!currentActorId) {
    return { result: { ok: false, message: "Missing actor id." }, status: 400 };
  }

  const result =
    type === "actor"
      ? await deps.actorHint(
          currentActorId,
          String(body.movieTitle ?? ""),
          mode,
          readExcludeActorIds(body.excludeActorIds)
        )
      : await deps.movieHint(currentActorId, mode);

  return { result, status: 200 };
}
