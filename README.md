<p align="center">
  <img src="public/box-office-logo.png" alt="Box Office" width="120">
</p>

<h1 align="center">Box Office</h1>

<p align="center">Connect two actors through the films and TV they share.</p>

## What it is

You're given a starting actor and a target actor. Your job is to link them through
the people they've worked with. Every guess is checked against real TMDB cast data,
so you can't bluff your way through a filmography. The connections have to be real.

## How to play

1. You see the **current actor** and the **target** you're trying to reach.
2. Name a **title** the current actor is in, and a **co-star** from that title, both
   at once. The co-star can't be the current actor.
3. If both check out, that co-star becomes your new current actor.
4. Repeat until your co-star *is* the target. That's a win.

Spelling is forgiving: accents and punctuation don't matter, a leading "the/a/an" is
optional, and a co-star's last name usually works. Stuck? You get **3 hints**: one
reveals a title the actor is in, the other reveals a co-star once you've typed a title.

## Settings

- **Movies only / Movies + TV**: whether TV shows count as connections. Switching
  it starts a fresh game.
- **Easy / Medium / Hard**: how famous the two actors are, from household names down
  to "that person from that one movie." Also restarts the game.

## Scoring

A running box-office counter tracks the total gross of every title in your path, with
a final tally on the win screen. The goal is a short path *and* a low total. Films use
their real worldwide gross; TV has no box office, so it gets a comparable stand-in
value derived from its audience and run length (see `TV_VALUE_CONSTANT` in
`lib/tmdb.ts`).

## Setup

1. Grab a free TMDB API key: sign up at [themoviedb.org](https://www.themoviedb.org/signup),
   then go to [Settings → API](https://www.themoviedb.org/settings/api) and copy the
   **v3 API Key** (the short one).

2. Create `.env.local` in this folder:

   ```
   TMDB_API_KEY=your_v3_api_key_here
   ```

3. Install and run:

   ```bash
   npm install
   npm run dev
   ```

   Then open http://localhost:3000.

## Layout

| Path | What it does |
| --- | --- |
| `lib/tmdb.ts` | TMDB client. The API key stays server-side. |
| `lib/game.ts` | Move validation, the core game rule. |
| `app/api/start` | Picks a connectable start + target pair. |
| `app/api/guess` | Validates one move. |
| `app/play/page.tsx` | The game UI. |

## Deploying

Push to GitHub and import into [Vercel](https://vercel.com). Add `TMDB_API_KEY` as an
environment variable in the project settings; the API routes keep it server-side.
