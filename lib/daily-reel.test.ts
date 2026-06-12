import test from "node:test";
import assert from "node:assert/strict";
import {
  DAILY_REEL_CYCLE_LENGTH,
  getDailyReel,
  getTodayDailyReel,
} from "./daily-reel.ts";

function sharesMovie(a: { movieIds: number[] }, b: { movieIds: number[] }) {
  const movieIds = new Set(a.movieIds);
  return b.movieIds.some((movieId) => movieIds.has(movieId));
}

test("same date key always returns the same Daily Reel matchup", () => {
  const first = getDailyReel("2026-06-10");
  const second = getDailyReel("2026-06-10");

  assert.equal(first.date, second.date);
  assert.equal(first.start.id, second.start.id);
  assert.equal(first.target.id, second.target.id);
  assert.equal(first.mode, "all");
});

test("Daily Reel changes when the Eastern date rolls over", () => {
  const beforeMidnight = getTodayDailyReel(new Date("2026-06-10T03:59:00Z"));
  const afterMidnight = getTodayDailyReel(new Date("2026-06-10T04:01:00Z"));

  assert.notEqual(beforeMidnight.date, afterMidnight.date);
  assert.notEqual(`${beforeMidnight.start.id}:${beforeMidnight.target.id}`, `${afterMidnight.start.id}:${afterMidnight.target.id}`);
});

test("Daily Reel actors only come from the easy and medium committed pools", () => {
  const matchup = getDailyReel("2026-06-12");

  assert.equal(matchup.start.tier, "easy");
  assert.match(matchup.target.tier, /^(easy|medium)$/);
});

test("Daily Reel pairs never share a movie credit", () => {
  let currentDate = new Date(Date.UTC(2026, 6, 10));

  for (let offset = 0; offset < Math.min(60, DAILY_REEL_CYCLE_LENGTH); offset++) {
    const matchup = getDailyReel(currentDate.toISOString().slice(0, 10));
    assert.equal(sharesMovie(matchup.start, matchup.target), false);
    currentDate = new Date(currentDate.getTime() + 86_400_000);
  }
});

test("Daily Reel uses a 75/25 easy-easy versus easy-medium split", () => {
  let easyEasy = 0;
  let easyMedium = 0;
  let currentDate = new Date(Date.UTC(2026, 5, 10));

  for (let index = 0; index < DAILY_REEL_CYCLE_LENGTH; index++) {
    const dateKey = currentDate.toISOString().slice(0, 10);
    const matchup = getDailyReel(dateKey);

    assert.equal(matchup.start.tier, "easy");
    if (matchup.target.tier === "easy") {
      easyEasy++;
    } else {
      assert.equal(matchup.target.tier, "medium");
      easyMedium++;
    }

    currentDate = new Date(currentDate.getTime() + 86_400_000);
  }

  assert.equal(easyEasy + easyMedium, DAILY_REEL_CYCLE_LENGTH);
  assert.equal(easyMedium * 3, easyEasy);
});

test("dated lookups reproduce the archived daily matchup", () => {
  const archived = getDailyReel("2026-08-17");
  const fromClock = getTodayDailyReel(new Date("2026-08-17T16:00:00Z"));

  assert.equal(archived.date, fromClock.date);
  assert.equal(archived.start.id, fromClock.start.id);
  assert.equal(archived.target.id, fromClock.target.id);
});
