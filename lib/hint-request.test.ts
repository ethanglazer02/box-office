import test from "node:test";
import assert from "node:assert/strict";
import { resolveHintRequest } from "./hint-request-core.ts";

test("resolveHintRequest handles star-titles requests", async () => {
  let calledWith: { actorId: number; mode: "movie" | "all"; excludeTitleIds: number[] } | null = null;

  const response = await resolveHintRequest(
    { type: "star-titles", actorId: 42, mode: "movie", excludeTitleIds: ["8", 13] },
    {
      actorHint: async () => ({ ok: false, message: "unused" }),
      movieHint: async () => ({ ok: false, message: "unused" }),
      starTitlesHint: async (actorId, mode, excludeTitleIds) => {
        calledWith = { actorId, mode, excludeTitleIds };
        return {
          ok: true,
          message: "revealed",
          titles: [{ id: 1, name: "Heat", year: "1995", posterPath: null }],
          remainingTitles: 2,
        };
      },
    }
  );

  assert.deepEqual(calledWith, { actorId: 42, mode: "movie", excludeTitleIds: [8, 13] });
  assert.equal(response.status, 200);
  assert.equal(response.result.ok, true);
  assert.equal(response.result.titles?.[0]?.name, "Heat");
  assert.equal(response.result.remainingTitles, 2);
});

test("resolveHintRequest rejects star-titles requests without an actor id", async () => {
  const response = await resolveHintRequest(
    { type: "star-titles", mode: "all" },
    {
      actorHint: async () => ({ ok: false, message: "unused" }),
      movieHint: async () => ({ ok: false, message: "unused" }),
      starTitlesHint: async () => ({ ok: false, message: "unused" }),
    }
  );

  assert.equal(response.status, 400);
  assert.deepEqual(response.result, { ok: false, message: "Missing actor id." });
});

test("resolveHintRequest preserves the existing co-star hint request shape", async () => {
  let calledWith:
    | {
        currentActorId: number;
        movieTitle: string;
        mode: "movie" | "all";
        excludeActorIds: number[];
      }
    | null = null;

  const response = await resolveHintRequest(
    {
      type: "actor",
      currentActorId: 7,
      movieTitle: "Heat",
      mode: "all",
      excludeActorIds: ["12", 15, null],
    },
    {
      actorHint: async (currentActorId, movieTitle, mode, excludeActorIds) => {
        calledWith = { currentActorId, movieTitle, mode, excludeActorIds };
        return { ok: true, message: "actor hint", fill: "Val Kilmer" };
      },
      movieHint: async () => ({ ok: false, message: "unused" }),
      starTitlesHint: async () => ({ ok: false, message: "unused" }),
    }
  );

  assert.deepEqual(calledWith, {
    currentActorId: 7,
    movieTitle: "Heat",
    mode: "all",
    excludeActorIds: [12, 15],
  });
  assert.equal(response.status, 200);
  assert.equal(response.result.fill, "Val Kilmer");
});
