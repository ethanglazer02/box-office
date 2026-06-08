# 🎬 Box Office

Connect two actors through the movies and TV shows they share, then try to keep both
your path length and total box office as low as possible.

The twist: at each step you must name **both** a title the current actor appears in
**and** a co-star from that title, at the same time. The app verifies both against
real TMDB cast data, so you can't just scroll through someone's filmography. The
co-star you name becomes your next actor; reach the target to win.

## International films + guaranteed-solvable puzzles

Films **from anywhere** count as connections — the Korean *Parasite*, French cinema,
anime, all of it — so there's diversity in the titles you can link through.

The risk with foreign films is a dead end: an actor whose entire filmography is, say,
all-Korean-cast films would be impossible to *reach* from a Hollywood start. We avoid
that not by banning foreign films, but by only ever choosing **start/target actors who
have a "bridge"** — i.e. at least one notable English-language credit (this falls out
of the fame banding below, which scores actors by their biggest English-language role).
That guarantees every endpoint connects into the densely-linked mainstream graph, so a
path always exists. International actors with crossover credits (e.g. Lee Byung-hun)
can still be endpoints; pure-foreign-only actors can't.

## Movies-only vs Movies + TV

A toggle at the top switches between **Movies + TV** (TV shows count as connections
too) and **Movies only** (TV doesn't count for guesses, hints, the title autocomplete,
or the starting pair). Switching either this or the difficulty starts a fresh game,
since the start/target pairing depends on both.

## Difficulty modes

Pick **Easy / Medium / Hard** at the top of the game — it controls how famous the
start and target actors are:

- **Easy** — a curated list of household names.
- **Medium** — well-known but not A-list (think Winona Ryder, Sam Elliott).
- **Hard** — recognizable C-listers / character actors (think Jennifer Love Hewitt,
  Elisha Cuthbert), not obscure deep cuts.

Difficulty is driven by a **fame score** rather than raw TMDB popularity (which is
noisy and gameable). The score is the vote count of a person's biggest
*English-language* credit — a free signal (it's already in the popularity payload)
that both measures recognizability and, via a ceiling, keeps superstars out of the
harder tiers so they stay recognizable without being household names.

Whatever the mode, the pair is guaranteed to be two real actors with enough credits
to be connectable, and never two who already share a movie (that'd be a one-move
gimme). Adult/softcore performers are filtered out via a vote-count threshold.

## Box-office tally

Every movie you link through has a real worldwide gross (pulled from TMDB per
verified title). The game tallies it as you go — a running **🍿 Box office along
your path** counter, per-link grosses in the chain, and a final total on the win
screen ("Your path grossed $4.2B"). TV links contribute $0, so this number means
the most in Movies-only mode.

## Setup

1. **Get a free TMDB API key.** Create an account at
   [themoviedb.org](https://www.themoviedb.org/signup), then go to
   [Settings → API](https://www.themoviedb.org/settings/api) and request a key.
   Use the **v3 API Key** (the shorter one, not the long bearer token).

2. **Add it to the environment.** Create a file named `.env.local` in this folder:

   ```
   TMDB_API_KEY=your_v3_api_key_here
   ```

3. **Install and run:**

   ```bash
   npm install
   npm run dev
   ```

   Open http://localhost:3000.

## How a move is validated

1. We look up the **current actor's own credit list** and find the title you typed.
   Matching it there proves the actor is in it — no ambiguity about which film.
2. We pull that title's **full cast** and confirm the **co-star** you named is in it.
3. If the co-star is the target, you win. Otherwise the co-star becomes the new
   current actor and you keep going.

Matching is forgiving: punctuation/accents are ignored, a leading "the/a/an" is
dropped, and a co-star's last name usually works.

## Project layout

| Path | What it does |
| --- | --- |
| `lib/tmdb.ts` | Server-side TMDB client. The API key never reaches the browser. |
| `lib/game.ts` | The validation logic (the core game rule). |
| `app/api/start` | Picks a random start + target pair from a pool of well-connected stars. |
| `app/api/guess` | Validates one move. |
| `app/api/actor-search` | Actor lookup (for a future "pick your own actors" mode). |
| `app/page.tsx` | The game UI. |

## Deploying

Push to GitHub and import into [Vercel](https://vercel.com). Add `TMDB_API_KEY` as
an environment variable in the project settings. The API routes keep your key
server-side.

## Ideas to extend

- Let players choose their own start/target with the actor-search endpoint.
- Block reusing the same title or actor twice.
- A daily challenge with a fixed pair and a shareable score.
- Hint system (reveal a shared title) at the cost of a step.
