"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Autocomplete, { Suggestion } from "./Autocomplete";
import SiteFooter from "../SiteFooter";

const IMG = "https://image.tmdb.org/t/p/w185";
const IMG_LARGE = "https://image.tmdb.org/t/p/w500";

async function fetchTitleSuggestions(q: string, mode: Mode): Promise<Suggestion[]> {
  const res = await fetch(`/api/title-search?q=${encodeURIComponent(q)}&mode=${mode}`);
  const data = await res.json();
  return (data.results || []).map((t: any) => ({
    id: t.id,
    primary: t.title,
    secondary: t.year || undefined
  }));
}

async function fetchActorSuggestions(q: string): Promise<Suggestion[]> {
  const res = await fetch(`/api/actor-search?q=${encodeURIComponent(q)}`);
  const data = await res.json();
  return (data.results || []).map((p: any) => ({
    id: p.id,
    primary: p.name,
    image: p.profilePath
  }));
}

type Difficulty = "easy" | "medium" | "hard";
const DIFFICULTIES: { id: Difficulty; label: string; blurb: string }[] = [
  { id: "easy", label: "Easy", blurb: "household names" },
  { id: "medium", label: "Medium", blurb: "lesser-known faces" },
  { id: "hard", label: "Hard", blurb: "deep cuts" }
];

type Mode = "movie" | "all";
const MODES: { id: Mode; label: string }[] = [
  { id: "all", label: "Movies + TV" },
  { id: "movie", label: "Movies only" }
];

interface Person {
  id: number;
  name: string;
  profilePath: string | null;
  knownFor?: string;
}
interface ChainLink {
  actor: Person;
  // Title that connected the PREVIOUS actor to this one (null for the start).
  via: { name: string; year: string | null; revenue: number } | null;
}

interface UndoSnapshot {
  chain: ChainLink[];
  movie: string;
  costar: string;
  feedback: { text: string; good: boolean } | null;
  status: "playing" | "won";
  hintsLeft: number;
  usedActorHints: Record<string, number[]>;
}

function MarqueeLogo() {
  return <span className="brand-mark">BO</span>;
}

function PersonInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("");
}

// Compact box-office formatting: $1.2B, $345M, $4.5M, or "—" when unknown.
function money(n: number): string {
  if (!n || n <= 0) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${(n / 1e3).toFixed(0)}K`;
}

function normalizeHintKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function Avatar({ person, onZoom }: { person: Person; onZoom?: (p: Person) => void }) {
  if (person.profilePath) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        className={`avatar ${onZoom ? "zoomable" : ""}`}
        src={IMG + person.profilePath}
        alt={person.name}
        onClick={onZoom ? () => onZoom(person) : undefined}
        title={onZoom ? "Click to enlarge" : undefined}
      />
    );
  }
  return <div className="avatar">{PersonInitials(person.name)}</div>;
}

export default function Page() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [target, setTarget] = useState<Person | null>(null);
  const [chain, setChain] = useState<ChainLink[]>([]);

  const [movie, setMovie] = useState("");
  const [costar, setCostar] = useState("");
  const [checking, setChecking] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; good: boolean } | null>(null);
  const [status, setStatus] = useState<"playing" | "won">("playing");
  const [hintsLeft, setHintsLeft] = useState(3);
  const [hinting, setHinting] = useState(false);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [mode, setMode] = useState<Mode>("all");
  const [showSettings, setShowSettings] = useState(false);
  const [zoomed, setZoomed] = useState<Person | null>(null);
  const [usedActorHints, setUsedActorHints] = useState<Record<string, number[]>>({});
  const [undoHistory, setUndoHistory] = useState<UndoSnapshot[]>([]);

  // Memoized so the Autocomplete effect doesn't re-fire on unrelated re-renders.
  const titleFetch = useCallback((q: string) => fetchTitleSuggestions(q, mode), [mode]);
  const actorFetch = useCallback((q: string) => fetchActorSuggestions(q), []);

  const current = chain.length ? chain[chain.length - 1].actor : null;
  const stepsUsed = Math.max(0, chain.length - 1);
  const totalGross = chain.reduce((sum, l) => sum + (l.via?.revenue ?? 0), 0);
  const actorHintKey = current ? `${current.id}|${mode}|${normalizeHintKey(movie)}` : "";

  async function newGame(diff: Difficulty = difficulty, m: Mode = mode) {
    setLoading(true);
    setError(null);
    setFeedback(null);
    setStatus("playing");
    setMovie("");
    setCostar("");
    setHintsLeft(3);
    setDifficulty(diff);
    setMode(m);
    setUsedActorHints({});
    setUndoHistory([]);
    try {
      const res = await fetch(`/api/start?difficulty=${diff}&mode=${m}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start game.");
      setTarget(data.target);
      setChain([{ actor: data.start, via: null }]);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function snapshotState(): UndoSnapshot {
    return {
      chain,
      movie,
      costar,
      feedback,
      status,
      hintsLeft,
      usedActorHints
    };
  }

  useEffect(() => {
    // Honor ?difficulty= from the homepage links on first load.
    const p = new URLSearchParams(window.location.search).get("difficulty");
    const start: Difficulty = p === "easy" || p === "medium" || p === "hard" ? p : "medium";
    newGame(start, mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close the enlarged photo with Escape.
  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setZoomed(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomed]);

  async function submitGuess(e: React.FormEvent) {
    e.preventDefault();
    if (!current || !target || checking || status !== "playing") return;
    setChecking(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/guess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentActorId: current.id,
          targetActorId: target.id,
          movieTitle: movie,
          costarName: costar,
          mode
        })
      });
      const data = await res.json();

      if (!data.valid) {
        setFeedback({ text: data.message, good: false });
        return;
      }

      setUndoHistory((prev) => [...prev, snapshotState()]);

      const nextChain: ChainLink[] = [
        ...chain,
        {
          actor: data.newActor,
          via: data.title
            ? { name: data.title.name, year: data.title.year, revenue: data.title.revenue ?? 0 }
            : null
        }
      ];
      setChain(nextChain);
      setMovie("");
      setCostar("");

      if (data.won) {
        setStatus("won");
        setFeedback({ text: data.message, good: true });
      } else {
        setFeedback({ text: data.message, good: true });
      }
    } catch (e: any) {
      setFeedback({ text: e.message || "Network error.", good: false });
    } finally {
      setChecking(false);
    }
  }

  function undoStep() {
    if (undoHistory.length === 0 || checking || hinting) return;
    const previous = undoHistory[undoHistory.length - 1];
    setUndoHistory((prev) => prev.slice(0, -1));
    setChain(previous.chain);
    setMovie(previous.movie);
    setCostar(previous.costar);
    setFeedback(previous.feedback);
    setStatus(previous.status);
    setHintsLeft(previous.hintsLeft);
    setUsedActorHints(previous.usedActorHints);
  }

  async function requestHint(type: "movie" | "actor") {
    if (!current || hinting || hintsLeft <= 0 || status !== "playing") return;
    if (type === "actor" && !movie.trim()) {
      setFeedback({ text: "Fill in a movie first to get a co-star hint.", good: false });
      return;
    }
    setHinting(true);
    try {
      const res = await fetch("/api/hint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentActorId: current.id,
          type,
          movieTitle: movie,
          mode,
          excludeActorIds: type === "actor" ? (usedActorHints[actorHintKey] ?? []) : []
        })
      });
      const data = await res.json();
      if (!data.ok) {
        // A failed hint (e.g. invalid movie) doesn't cost a hint.
        setFeedback({ text: data.message, good: false });
        return;
      }
      setUndoHistory((prev) => [...prev, snapshotState()]);
      // Drop the hint into the matching field and spend one hint.
      if (type === "movie") setMovie(data.fill);
      else {
        setCostar(data.fill);
        if (data.actorId) {
          setUsedActorHints((prev) => ({
            ...prev,
            [actorHintKey]: [...(prev[actorHintKey] ?? []), data.actorId]
          }));
        }
      }
      setHintsLeft((h) => h - 1);
      setFeedback({ text: data.message, good: true });
    } catch (e: any) {
      setFeedback({ text: e.message || "Couldn't fetch a hint.", good: false });
    } finally {
      setHinting(false);
    }
  }

  if (loading) return <div className="wrap"><div className="center">Dealing the cast…</div></div>;
  if (error)
    return (
      <div className="wrap">
        <div className="center">
          <p>{error}</p>
          <button onClick={() => newGame()}>Try again</button>
        </div>
      </div>
    );

  return (
    <div className="wrap">
      <div className="topbar">
        <Link href="/" className="brand">
          <MarqueeLogo />
          <span>
            Box Office
          </span>
        </Link>
        <div className="topbar-actions">
          <button type="button" className="btn btn-ghost btn-topbar" onClick={() => newGame()}>
            New game
          </button>
          <button
            type="button"
            className="pill settings-toggle"
            onClick={() => setShowSettings((s) => !s)}
            aria-expanded={showSettings}
          >
            <span className="gear">⚙</span>
            {DIFFICULTIES.find((d) => d.id === difficulty)?.label}
            <span className="pill-sep">·</span>
            {mode === "movie" ? "Movies" : "Movies + TV"}
          </button>
        </div>
      </div>

      {showSettings && (
        <div className="settings-panel settings-panel-inline">
          <div>
            <div className="grp-label">Difficulty</div>
            <div className="seg">
            {DIFFICULTIES.map((d) => (
              <button
                key={d.id}
                type="button"
                aria-pressed={difficulty === d.id}
                onClick={() => {
                  setShowSettings(false);
                  newGame(d.id, mode);
                }}
              >
                {d.label}
              </button>
            ))}
            </div>
          </div>
          <div>
            <div className="grp-label">Catalogue</div>
            <div className="seg">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={mode === m.id}
                onClick={() => {
                  setShowSettings(false);
                  newGame(difficulty, m.id);
                }}
              >
                {m.label}
              </button>
            ))}
            </div>
          </div>
        </div>
      )}

      {target && current && (
        <div className="goal">
          <div className="bill">
            <div className="who">
              <Avatar person={current} onZoom={setZoomed} />
              <div className="meta">
                <div className="lbl">Currently at</div>
                <div className="nm">{current.name}</div>
              </div>
            </div>
            <div className="arrow">→</div>
            <div className="who">
              <Avatar person={target} onZoom={setZoomed} />
              <div className="meta">
                <div className="lbl">Target</div>
                <div className="nm">{target.name}</div>
              </div>
            </div>
          </div>
          <div className="steps">
            <div className="num">{stepsUsed}</div>
            <div className="lbl">links used</div>
          </div>
        </div>
      )}

      <div className="chain">
        {chain.map((link, i) => {
          if (i === 0) {
            return (
              <div className="connector" key={`${link.actor.id}-${i}`}>
                <div className={`node ${i === chain.length - 1 && status === "playing" ? "is-current" : ""}`}>
                  <Avatar person={link.actor} onZoom={setZoomed} />
                  <div>
                    <div className="role">Start</div>
                    <div className="nm">{link.actor.name}</div>
                  </div>
                </div>
              </div>
            );
          }

          const linkData = link.via;
          if (!linkData) return null;

          return (
            <div className="connector" key={`${link.actor.id}-${i}`}>
              <div className="ticket">
                <div className="stub">
                  <div className="poster" aria-hidden="true">
                    <div className="pt">{linkData.name}</div>
                  </div>
                  <div className="serial">№ {String(link.actor.id).padStart(6, "0")}</div>
                </div>
                <div className="body">
                  <div className="feat-lbl">Featuring</div>
                  <div className="film">
                    {linkData.name} {linkData.year ? <span className="yr">{linkData.year}</span> : null}
                  </div>
                  <div className="reached">
                    <Avatar person={link.actor} onZoom={setZoomed} />
                    <span className="ar">↳</span>
                    <span className="rn">{link.actor.name}</span>
                  </div>
                </div>
                <div className="price">
                  <div className="pl">Box Office</div>
                  <div className="pv">{money(linkData.revenue)}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {totalGross > 0 && (
        <div className="tally">
          <div className="tl">🍿 Box office along your path</div>
          <div className="tv">{money(totalGross)}</div>
        </div>
      )}

      {status === "won" && (
        <div className="banner-scrim">
          <div className="banner win">
            <div className="b-kicker">Feature Complete</div>
            <div className="b-title">Connected in {stepsUsed} {stepsUsed === 1 ? "step" : "steps"}</div>
            <p className="b-sub">Your path grossed {money(totalGross)} at the box office. Ready for a new pairing?</p>
            <div className="b-stats">
              <div className="b-stat">
                <div className="v">{stepsUsed}</div>
                <div className="k">Steps Used</div>
              </div>
              <div className="b-stat">
                <div className="v">{money(totalGross)}</div>
                <div className="k">Path Gross</div>
              </div>
            </div>
            <div className="b-actions">
              <button type="button" className="btn btn-ghost" onClick={undoStep} disabled={undoHistory.length === 0}>
                Undo last step
              </button>
              <button type="button" className="btn btn-primary" onClick={() => newGame()}>
                New game
              </button>
            </div>
          </div>
        </div>
      )}

      {status === "playing" && (
        <form className="panel" onSubmit={submitGuess}>
          <div className="fields">
            <div className="field">
              <label>Movie or show</label>
              <Autocomplete
                value={movie}
                onChange={setMovie}
                fetchSuggestions={titleFetch}
                placeholder={
                  mode === "movie"
                    ? `A movie ${current?.name ?? ""} is in`
                    : `A title ${current?.name ?? ""} appears in`
                }
                autoFocus
              />
            </div>
            <div className="field">
              <label>Co-star in it</label>
              <Autocomplete
                value={costar}
                onChange={setCostar}
                fetchSuggestions={actorFetch}
                placeholder="Another actor from that title"
              />
            </div>
          </div>
          <div className="actions">
            <button type="submit" className="btn btn-primary" disabled={checking || !movie.trim() || !costar.trim()}>
              {checking ? "Checking…" : "Make the link"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={undoStep} disabled={undoHistory.length === 0 || checking || hinting}>
              Undo last step
            </button>
          </div>

          <div className="hints">
            <span className="hl">
              Hints left: <b>{hintsLeft}</b>
            </span>
            <button
              type="button"
              className="hint-btn"
              disabled={hinting || hintsLeft <= 0}
              onClick={() => requestHint("movie")}
              title="Reveal a movie the current actor is in"
            >
              💡 Movie
            </button>
            <button
              type="button"
              className="hint-btn"
              disabled={hinting || hintsLeft <= 0 || !movie.trim()}
              onClick={() => requestHint("actor")}
              title={
                movie.trim()
                  ? "Reveal a co-star from that movie"
                  : "Fill in a movie first to unlock this"
              }
            >
              💡 Co-star
            </button>
          </div>
          {feedback && (
            <div className={`verify-flash ${feedback.good ? "ok" : "no"}`}>{feedback.text}</div>
          )}
        </form>
      )}

      {zoomed && (
        <div className="lightbox" onClick={() => setZoomed(null)}>
          <figure onClick={(e) => e.stopPropagation()}>
            <div className="lb-img">
              {zoomed.profilePath ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={IMG_LARGE + zoomed.profilePath} alt={zoomed.name} />
              ) : (
                <div className="ini">{PersonInitials(zoomed.name)}</div>
              )}
            </div>
            <figcaption>{zoomed.name}</figcaption>
            <div className="lb-role">Featured Player</div>
          </figure>
        </div>
      )}
      <SiteFooter />
    </div>
  );
}
