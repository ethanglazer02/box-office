import { actorHint, movieHint, starTitlesHint } from "./game";
import { resolveHintRequest as resolveHintRequestCore } from "./hint-request-core";

export async function resolveHintRequest(body: {
  actorId?: unknown;
  currentActorId?: unknown;
  excludeActorIds?: unknown;
  mode?: unknown;
  movieTitle?: unknown;
  type?: unknown;
}) {
  return resolveHintRequestCore(body, {
    actorHint,
    movieHint,
    starTitlesHint,
  });
}
