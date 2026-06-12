import test from "node:test";
import assert from "node:assert/strict";
import {
  listStarHintTitles,
  pickNextStarHintTitle,
  type HintTitle,
  type HintTitleCredit
} from "./star-hint-titles.ts";

function credit(overrides: Partial<HintTitleCredit> = {}): HintTitleCredit {
  return {
    id: overrides.id ?? 1,
    title: overrides.title ?? "Default Title",
    year: overrides.year ?? "2020",
    releaseDate: overrides.releaseDate ?? "2020-01-01",
    mediaType: overrides.mediaType ?? "movie",
    posterPath: overrides.posterPath ?? "/poster.jpg",
    character: overrides.character,
    voteCount: overrides.voteCount ?? 100,
    originalLanguage: overrides.originalLanguage ?? "en",
  };
}

function names(titles: HintTitle[]) {
  return titles.map((title) => title.name);
}

test("listStarHintTitles returns up to three recognizable released titles in stable order", () => {
  const titles = listStarHintTitles(
    [
      credit({ id: 4, title: "Smaller Hit", voteCount: 5000, releaseDate: "2018-01-01" }),
      credit({ id: 2, title: "Biggest Hit", voteCount: 9000, releaseDate: "2022-01-01" }),
      credit({ id: 3, title: "Recent Hit", voteCount: 9000, releaseDate: "2024-01-01" }),
      credit({ id: 5, title: "TV Favorite", mediaType: "tv", voteCount: 9500, releaseDate: "2023-02-01" }),
      credit({ id: 6, title: "Fourth Place", voteCount: 1000, releaseDate: "2010-01-01" }),
    ],
    "all"
  );

  assert.deepEqual(names(titles), ["Recent Hit", "Biggest Hit", "Smaller Hit"]);
  assert.equal(titles.length, 3);
});

test("listStarHintTitles excludes unreleased and low-recognition foreign titles", () => {
  const titles = listStarHintTitles(
    [
      credit({ id: 1, title: "Eligible", voteCount: 4000, releaseDate: "2021-02-02" }),
      credit({ id: 2, title: "Future Movie", voteCount: 9999, releaseDate: "2999-01-01" }),
      credit({
        id: 3,
        title: "Low Vote Foreign",
        voteCount: 200,
        originalLanguage: "fr",
        releaseDate: "2019-04-04",
      }),
    ],
    "movie"
  );

  assert.deepEqual(names(titles), ["Eligible"]);
});

test("listStarHintTitles returns an empty list when nothing qualifies", () => {
  const titles = listStarHintTitles(
    [
      credit({ id: 1, title: "Future Only", releaseDate: "2999-01-01" }),
      credit({
        id: 2,
        title: "Obscure Foreign",
        originalLanguage: "es",
        voteCount: 100,
        releaseDate: "2010-01-01",
      }),
    ],
    "movie"
  );

  assert.deepEqual(titles, []);
});

test("listStarHintTitles is stable across repeated calls for the same credits", () => {
  const credits = [
    credit({ id: 1, title: "Alpha", voteCount: 7000, releaseDate: "2020-01-01" }),
    credit({ id: 2, title: "Bravo", voteCount: 7000, releaseDate: "2020-01-01" }),
    credit({ id: 3, title: "Charlie", voteCount: 6500, releaseDate: "2019-01-01" }),
  ];

  assert.deepEqual(listStarHintTitles(credits, "movie"), listStarHintTitles(credits, "movie"));
});

test("pickNextStarHintTitle reveals one title and reports remaining count", () => {
  const pool = [
    { id: 1, name: "Alpha", year: "2020", posterPath: null },
    { id: 2, name: "Bravo", year: "2019", posterPath: null },
    { id: 3, name: "Charlie", year: "2018", posterPath: null },
  ];

  assert.deepEqual(pickNextStarHintTitle(pool), {
    titles: [{ id: 1, name: "Alpha", year: "2020", posterPath: null }],
    remainingTitles: 2,
  });

  assert.deepEqual(pickNextStarHintTitle(pool, [1, 2]), {
    titles: [{ id: 3, name: "Charlie", year: "2018", posterPath: null }],
    remainingTitles: 0,
  });
});
