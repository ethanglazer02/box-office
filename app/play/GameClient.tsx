"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import SiteFooter from "../SiteFooter";
import Autocomplete, { Suggestion } from "./Autocomplete";

const IMG = "https://image.tmdb.org/t/p/w185";
const IMG_LARGE = "https://image.tmdb.org/t/p/w500";

async function fetchTitleSuggestions(q: string, mode: Mode): Promise<Suggestion[]> {
  const res = await fetch(`/api/title-search?q=${encodeURIComponent(q)}&mode=${mode}`);
  const data = await res.json();
  return (data.results || []).map((t: any) => ({
    id: t.id,
    primary: t.title,
    secondary: t.year || undefined,
  }));
}

async function fetchActorSuggestions(q: string): Promise<Suggestion[]> {
  const res = await fetch(`/api/actor-search?q=${encodeURIComponent(q)}`);
  const data = await res.json();
  return (data.results || []).map((p: any) => ({
    id: p.id,
    primary: p.name,
    image: p.profilePath,
  }));
}

type Difficulty = "easy" | "medium" | "hard";
const DIFFICULTIES: { id: Difficulty; label: string; blurb: string }[] = [
  { id: "easy", label: "Easy", blurb: "household names" },
  { id: "medium", label: "Medium", blurb: "recognizable faces" },
  { id: "hard", label: "Hard", blurb: "that person from that one movie" },
];

type Mode = "movie" | "all";
const MODES: { id: Mode; label: string }[] = [
  { id: "movie", label: "Movies only" },
  { id: "all", label: "Movies + TV" },
];

type Theme = "light" | "dark";
const THEMES: { id: Theme; label: string }[] = [
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
];

export type GameVariant = "free-play" | "daily";

interface Person {
  id: number;
  name: string;
  profilePath: string | null;
  knownFor?: string;
}

interface ChainLink {
  actor: Person;
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

interface ShareFeedback {
  text: string;
  good: boolean;
}

interface SharePayload {
  title: string;
  text: string;
  url: string;
}

interface SharedRound {
  difficulty: Difficulty;
  mode: Mode;
  startId: number;
  targetId: number;
}

export interface DailyReelResponse {
  date: string;
  start: Person;
  target: Person;
  mode: "movie";
  variant: "daily";
}

const SHARE_TARGETS = [
  { id: "x", label: "X", logo: "https://cdn.simpleicons.org/x/ffffff" },
  { id: "facebook", label: "Facebook", logo: "https://cdn.simpleicons.org/facebook/ffffff" },
  { id: "bluesky", label: "Bluesky", logo: "https://cdn.simpleicons.org/bluesky/ffffff" },
  { id: "whatsapp", label: "WhatsApp", logo: "https://cdn.simpleicons.org/whatsapp/ffffff" },
  { id: "telegram", label: "Telegram", logo: "https://cdn.simpleicons.org/telegram/ffffff" },
  { id: "reddit", label: "Reddit", logo: "https://cdn.simpleicons.org/reddit/ffffff" },
  { id: "messages", label: "Messages", logo: "https://cdn.simpleicons.org/imessage/ffffff" },
  { id: "copy", label: "Copy link", logo: null },
] as const;

function MarqueeLogo() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/box-office-logo.png" alt="" className="brand-logo" aria-hidden="true" />
  );
}

function UndoButton({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="btn btn-undo"
      onClick={onClick}
      disabled={disabled}
      aria-label="Undo last step"
      title="Undo last step"
    >
      <svg viewBox="0 0 24 24" className="undo-icon" aria-hidden="true">
        <path d="M9 7L5 11L9 15" className="undo-icon-arrow" />
        <path
          d="M5.5 11H13.25C16.15 11 18.5 13.35 18.5 16.25C18.5 19.15 16.15 21.5 13.25 21.5H10.75"
          className="undo-icon-arrow"
        />
      </svg>
    </button>
  );
}

function PersonInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("");
}

function money(n: number): string {
  if (!n || n <= 0) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${(n / 1e3).toFixed(0)}K`;
}

function normalizeHintKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function readPersonId(prefix: "start" | "target", params: URLSearchParams): number | null {
  const id = Number(params.get(`${prefix}Id`));
  return Number.isFinite(id) && id > 0 ? id : null;
}

function readSharedRound(params: URLSearchParams): SharedRound | null {
  const difficultyParam = params.get("difficulty");
  const modeParam = params.get("mode");
  const difficulty: Difficulty =
    difficultyParam === "easy" || difficultyParam === "medium" || difficultyParam === "hard"
      ? difficultyParam
      : "easy";
  const mode: Mode = modeParam === "movie" || modeParam === "all" ? modeParam : "movie";
  const startId = readPersonId("start", params);
  const targetId = readPersonId("target", params);
  if (!startId || !targetId || startId === targetId) return null;
  return { difficulty, mode, startId, targetId };
}

function formatDateKey(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function Avatar({ person, onZoom }: { person: Person; onZoom?: (p: Person) => void }) {
  if (person.profilePath) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
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

export default function GameClient({ variant }: { variant: GameVariant }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [target, setTarget] = useState<Person | null>(null);
  const [chain, setChain] = useState<ChainLink[]>([]);
  const [dailyDate, setDailyDate] = useState<string | null>(null);

  const [movie, setMovie] = useState("");
  const [costar, setCostar] = useState("");
  const [checking, setChecking] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; good: boolean } | null>(null);
  const [status, setStatus] = useState<"playing" | "won">("playing");
  const [hintsLeft, setHintsLeft] = useState(3);
  const [hinting, setHinting] = useState(false);
  const [activeHintType, setActiveHintType] = useState<"movie" | "actor" | null>(null);
  const [movieHintFillSignal, setMovieHintFillSignal] = useState(0);
  const [costarHintFillSignal, setCostarHintFillSignal] = useState(0);
  const [difficulty, setDifficulty] = useState<Difficulty>("easy");
  const [mode, setMode] = useState<Mode>(variant === "daily" ? "movie" : "movie");
  const [theme, setTheme] = useState<Theme>(() =>
    typeof document !== "undefined" && document.documentElement.dataset.theme === "light"
      ? "light"
      : "dark"
  );
  const [showSettings, setShowSettings] = useState(false);
  const [zoomed, setZoomed] = useState<Person | null>(null);
  const [usedActorHints, setUsedActorHints] = useState<Record<string, number[]>>({});
  const [undoHistory, setUndoHistory] = useState<UndoSnapshot[]>([]);
  const [shareFeedback, setShareFeedback] = useState<ShareFeedback | null>(null);
  const settingsRef = useRef<HTMLDivElement | null>(null);

  const titleFetch = useCallback((q: string) => fetchTitleSuggestions(q, mode), [mode]);
  const actorFetch = useCallback((q: string) => fetchActorSuggestions(q), []);

  const current = chain.length ? chain[chain.length - 1].actor : null;
  const stepsUsed = Math.max(0, chain.length - 1);
  const totalGross = chain.reduce((sum, link) => sum + (link.via?.revenue ?? 0), 0);
  const actorHintKey = current ? `${current.id}|${mode}|${normalizeHintKey(movie)}` : "";
  const roundActorIds = chain.map((link) => link.actor.id);

  const resetRoundState = useCallback(() => {
    setError(null);
    setFeedback(null);
    setStatus("playing");
    setMovie("");
    setCostar("");
    setHintsLeft(3);
    setUsedActorHints({});
    setUndoHistory([]);
    setShareFeedback(null);
  }, []);

  const syncFreePlayUrl = useCallback(
    (start: Person, nextTarget: Person, diff: Difficulty, nextMode: Mode) => {
      const params = new URLSearchParams();
      params.set("difficulty", diff);
      params.set("mode", nextMode);
      params.set("startId", String(start.id));
      params.set("targetId", String(nextTarget.id));
      window.history.replaceState({}, "", `/play?${params.toString()}`);
    },
    []
  );

  const syncDailyUrl = useCallback((date: string) => {
    const params = new URLSearchParams();
    params.set("date", date);
    window.history.replaceState({}, "", `/daily?${params.toString()}`);
  }, []);

  const hydrateSharedRound = useCallback(
    async (sharedRound: SharedRound) => {
      const res = await fetch(`/api/people?ids=${sharedRound.startId},${sharedRound.targetId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load shared matchup.");

      const people = Array.isArray(data.results) ? data.results : [];
      const start = people.find((person: Person) => person.id === sharedRound.startId) ?? null;
      const nextTarget = people.find((person: Person) => person.id === sharedRound.targetId) ?? null;
      if (!start || !nextTarget) throw new Error("Shared matchup is no longer available.");

      setDifficulty(sharedRound.difficulty);
      setMode(sharedRound.mode);
      setDailyDate(null);
      setTarget(nextTarget);
      setChain([{ actor: start, via: null }]);
      resetRoundState();
      setLoading(false);
      syncFreePlayUrl(start, nextTarget, sharedRound.difficulty, sharedRound.mode);
    },
    [resetRoundState, syncFreePlayUrl]
  );

  async function newGame(diff: Difficulty = difficulty, nextMode: Mode = mode) {
    setLoading(true);
    setDifficulty(diff);
    setMode(nextMode);
    setDailyDate(null);
    resetRoundState();

    try {
      const res = await fetch(`/api/start?difficulty=${diff}&mode=${nextMode}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start game.");
      setTarget(data.target);
      setChain([{ actor: data.start, via: null }]);
      syncFreePlayUrl(data.start, data.target, diff, nextMode);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadDailyRound(dateOverride?: string | null) {
    setLoading(true);
    setMode("movie");
    setDailyDate(dateOverride ?? null);
    resetRoundState();

    try {
      const params = new URLSearchParams();
      if (dateOverride) params.set("date", dateOverride);
      const query = params.toString();
      const res = await fetch(`/api/daily${query ? `?${query}` : ""}`);
      const data: DailyReelResponse | { error?: string } = await res.json();
      if (!res.ok || !("start" in data) || !("target" in data) || !("date" in data)) {
        throw new Error(("error" in data && data.error) || "Failed to load the Daily Reel.");
      }

      setTarget(data.target);
      setChain([{ actor: data.start, via: null }]);
      setDailyDate(data.date);
      syncDailyUrl(data.date);
    } catch (e: any) {
      setError(e.message || "Failed to load the Daily Reel.");
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
      usedActorHints,
    };
  }

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams(window.location.search);

    if (variant === "daily") {
      // Always load today's Daily Reel, ignoring any `date` param from a
      // shared/older link so previous-day links land on the current reel.
      void (async () => {
        try {
          await loadDailyRound(null);
        } catch (e: any) {
          if (cancelled) return;
          setError(e.message || "Failed to load the Daily Reel.");
          setLoading(false);
        }
      })();

      return () => {
        cancelled = true;
      };
    }

    const sharedRound = readSharedRound(params);
    if (sharedRound) {
      void (async () => {
        try {
          await hydrateSharedRound(sharedRound);
        } catch (e: any) {
          if (cancelled) return;
          setError(e.message || "Failed to load shared matchup.");
          setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    const difficultyParam = params.get("difficulty");
    const modeParam = params.get("mode");
    const startDifficulty: Difficulty =
      difficultyParam === "easy" || difficultyParam === "medium" || difficultyParam === "hard"
        ? difficultyParam
        : "easy";
    const startMode: Mode = modeParam === "movie" || modeParam === "all" ? modeParam : "movie";
    void newGame(startDifficulty, startMode);

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrateSharedRound, variant]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem("box-office-theme", theme);
    } catch {}
  }, [theme]);

  useEffect(() => {
    if (!showSettings) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!settingsRef.current?.contains(event.target as Node)) {
        setShowSettings(false);
      }
    };

    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [showSettings]);

  useEffect(() => {
    if (!zoomed) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setZoomed(null);
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
          mode,
        }),
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
            : null,
        },
      ];
      setChain(nextChain);
      setMovie("");
      setCostar("");

      if (data.won) {
        setStatus("won");
      }
      setFeedback({ text: data.message, good: true });
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
    setActiveHintType(type);
    try {
      const res = await fetch("/api/hint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentActorId: current.id,
          type,
          movieTitle: movie,
          mode,
          excludeActorIds:
            type === "actor"
              ? [...new Set([...roundActorIds, ...(usedActorHints[actorHintKey] ?? [])])]
              : [],
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setFeedback({ text: data.message, good: false });
        return;
      }

      setUndoHistory((prev) => [...prev, snapshotState()]);

      if (type === "movie") {
        setMovie(data.fill);
        setMovieHintFillSignal((value) => value + 1);
      } else {
        setCostar(data.fill);
        setCostarHintFillSignal((value) => value + 1);
        if (data.actorId) {
          setUsedActorHints((prev) => ({
            ...prev,
            [actorHintKey]: [...(prev[actorHintKey] ?? []), data.actorId],
          }));
        }
      }

      setHintsLeft((value) => value - 1);
      setFeedback({ text: data.message, good: true });
    } catch (e: any) {
      setFeedback({ text: e.message || "Couldn't fetch a hint.", good: false });
    } finally {
      setHinting(false);
      setActiveHintType(null);
    }
  }

  function getSharePayload(): SharePayload | null {
    if (!target || chain.length === 0) return null;

    if (variant === "daily" && dailyDate) {
      const url = `${window.location.origin}/daily?date=${dailyDate}`;
      return {
        title: "The Daily Reel",
        text: `I completed the Daily Reel for ${formatDateKey(dailyDate)} in ${stepsUsed} ${stepsUsed === 1 ? "link" : "links"} with a total box office of ${money(totalGross)}. Can you do better?`,
        url,
      };
    }

    const startActor = chain[0].actor;
    const difficultyLabel = DIFFICULTIES.find((entry) => entry.id === difficulty)?.label ?? "Medium";
    const modeLabel = mode === "movie" ? "Movies only" : "Movies + TV";
    const params = new URLSearchParams();
    params.set("difficulty", difficulty);
    params.set("mode", mode);
    params.set("startId", String(startActor.id));
    params.set("targetId", String(target.id));
    const url = `${window.location.origin}/play?${params.toString()}`;
    const text =
      `Box Office Challenge\n` +
      `${startActor.name} → ${target.name}\n` +
      `${stepsUsed} ${stepsUsed === 1 ? "link" : "links"} • ${money(totalGross)} path gross\n` +
      `${difficultyLabel} • ${modeLabel}\n\n` +
      `Think you know nicher movies? Beat my run with a lower box office path.`;

    return {
      title: "Box Office Challenge",
      text,
      url,
    };
  }

  function openShareWindow(url: string) {
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function handleShareTarget(targetName: string) {
    const payload = getSharePayload();
    if (!payload) return;

    const encodedUrl = encodeURIComponent(payload.url);
    const encodedText = encodeURIComponent(`${payload.text}\n${payload.url}`);
    const encodedMessages = encodeURIComponent(`${payload.text}\n\n${payload.url}`);

    try {
      switch (targetName) {
        case "x":
          openShareWindow(`https://twitter.com/intent/tweet?text=${encodedText}`);
          break;
        case "facebook":
          openShareWindow(
            `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}&quote=${encodeURIComponent(payload.text)}`
          );
          break;
        case "bluesky":
          openShareWindow(`https://bsky.app/intent/compose?text=${encodedText}`);
          break;
        case "whatsapp":
          openShareWindow(`https://wa.me/?text=${encodedText}`);
          break;
        case "telegram":
          openShareWindow(`https://t.me/share/url?url=${encodedUrl}&text=${encodeURIComponent(payload.text)}`);
          break;
        case "reddit":
          openShareWindow(
            `https://www.reddit.com/submit?url=${encodedUrl}&title=${encodeURIComponent(payload.title)}`
          );
          break;
        case "messages":
          window.location.href = `sms:&body=${encodedMessages}`;
          break;
        case "copy":
          await navigator.clipboard.writeText(`${payload.text}\n\n${payload.url}`);
          setShareFeedback({ text: "Share text copied to clipboard.", good: true });
          return;
        default:
          return;
      }

      setShareFeedback({ text: "Share link opened.", good: true });
    } catch {
      setShareFeedback({ text: "Couldn't open that share option.", good: false });
    }
  }

  const retryAction =
    variant === "daily"
      ? () => loadDailyRound(dailyDate)
      : () => {
          void newGame();
        };

  return (
    <div className="wrap">
      <div className="topbar">
        <Link href="/" className="brand">
          <MarqueeLogo />
          <span>Box Office</span>
        </Link>
        <div className="topbar-actions">
          {variant === "free-play" ? (
            <>
              <button type="button" className="btn btn-ghost btn-topbar" onClick={() => void newGame()}>
                New game
              </button>
              <div className="settings-anchor" ref={settingsRef}>
                <button
                  type="button"
                  className="pill settings-toggle"
                  onClick={() => setShowSettings((showing) => !showing)}
                  aria-expanded={showSettings}
                >
                  <span className="gear">⚙</span>
                  {DIFFICULTIES.find((entry) => entry.id === difficulty)?.label}
                  <span className="pill-sep">·</span>
                  {mode === "movie" ? "Movies" : "Movies + TV"}
                </button>

                {showSettings && (
                  <div className="settings-panel settings-panel-popover">
                    <div>
                      <div className="grp-label">Difficulty</div>
                      <div className="seg">
                        {DIFFICULTIES.map((entry) => (
                          <button
                            key={entry.id}
                            type="button"
                            aria-pressed={difficulty === entry.id}
                            onClick={() => {
                              setShowSettings(false);
                              void newGame(entry.id, mode);
                            }}
                          >
                            {entry.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="grp-label">Catalogue</div>
                      <div className="seg">
                        {MODES.map((entry) => (
                          <button
                            key={entry.id}
                            type="button"
                            aria-pressed={mode === entry.id}
                            onClick={() => {
                              setShowSettings(false);
                              void newGame(difficulty, entry.id);
                            }}
                          >
                            {entry.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="grp-label">Theme</div>
                      <div className="seg">
                        {THEMES.map((entry) => (
                          <button
                            key={entry.id}
                            type="button"
                            aria-pressed={theme === entry.id}
                            onClick={() => setTheme(entry.id)}
                          >
                            {entry.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-ghost btn-topbar"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              >
                {theme === "dark" ? "Light mode" : "Dark mode"}
              </button>
              <Link href="/free-play" className="btn btn-primary btn-topbar">
                Free Play
              </Link>
            </>
          )}
        </div>
      </div>

      {variant === "daily" && dailyDate && !loading && !error && (
        <section className="daily-hero">
          <div className="daily-hero-kicker">The Daily Reel</div>
          <div className="daily-hero-headline">
            <h1>{formatDateKey(dailyDate)}</h1>
            <span className="daily-hero-badge">Movies only</span>
          </div>
        </section>
      )}

      {loading ? (
        <div className="loading-stage" aria-live="polite" aria-busy="true">
          <div className="loading-marquee" aria-hidden="true">
            <span className="loading-reel" />
            <span className="loading-reel" />
            <span className="loading-reel" />
          </div>
          <div className="loading-copy">
            <div className="loading-kicker">
              {variant === "daily" ? "Loading Daily Reel" : "Building Matchup"}
            </div>
            <div className="loading-title">
              {variant === "daily" ? "Threading today’s cast…" : "Dealing the cast…"}
            </div>
            <p className="loading-text">
              {variant === "daily"
                ? "Pulling the shared movie-only challenge for today."
                : "Pulling a fresh start and target from TMDB."}
            </p>
          </div>
        </div>
      ) : error ? (
        <div className="center">
          <p>{error}</p>
          <button type="button" className="btn btn-primary" onClick={retryAction}>
            Try again
          </button>
        </div>
      ) : (
        <>
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
                    <div className="lbl">{variant === "daily" ? "Finish at" : "Target"}</div>
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
            {chain.map((link, index) => {
              if (index === 0) {
                return (
                  <div className="connector" key={`${link.actor.id}-${index}`}>
                    <div className={`node ${index === chain.length - 1 && status === "playing" ? "is-current" : ""}`}>
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
                <div className="connector" key={`${link.actor.id}-${index}`}>
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
                <div className="b-kicker">{variant === "daily" ? "Daily Cleared" : "Feature Complete"}</div>
                <div className="b-title">
                  Connected in {stepsUsed} {stepsUsed === 1 ? "step" : "steps"}
                </div>
                <p className="b-sub">
                  {variant === "daily" && dailyDate
                    ? `You cleared the ${formatDateKey(dailyDate)} Daily Reel with a path gross of ${money(totalGross)}.`
                    : `Your path grossed ${money(totalGross)} at the box office. Ready for a new pairing?`}
                </p>
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
                  {variant === "daily" ? (
                    <Link href="/free-play" className="btn btn-primary">
                      Try Free Play
                    </Link>
                  ) : (
                    <button type="button" className="btn btn-primary" onClick={() => void newGame()}>
                      New game
                    </button>
                  )}
                </div>
                <div className="share-inline">
                  <div className="share-inline-label">Share your run</div>
                  <div className="share-inline-grid">
                    {SHARE_TARGETS.map((shareTarget) => (
                      <button
                        key={shareTarget.id}
                        type="button"
                        className={`share-pill share-pill-${shareTarget.id}`}
                        onClick={() => void handleShareTarget(shareTarget.id)}
                      >
                        {shareTarget.logo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img className="share-pill-logo" src={shareTarget.logo} alt="" aria-hidden="true" />
                        ) : shareTarget.id === "copy" ? null : (
                          <span className="share-pill-mark" aria-hidden="true">
                            ↗
                          </span>
                        )}
                        <span className="share-pill-label">{shareTarget.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
                {shareFeedback && (
                  <div className={`share-flash ${shareFeedback.good ? "ok" : "no"}`}>{shareFeedback.text}</div>
                )}
              </div>
            </div>
          )}

          {status === "playing" && (
            <form className="panel" onSubmit={submitGuess}>
              <div className="fields">
                <div className="field">
                  <label>Movie</label>
                  <Autocomplete
                    value={movie}
                    onChange={setMovie}
                    fetchSuggestions={titleFetch}
                    suppressNextOpenSignal={movieHintFillSignal}
                    placeholder={`A movie ${current?.name ?? ""} is in`}
                    autoFocus
                  />
                </div>
                <div className="field">
                  <label>Co-star in it</label>
                  <Autocomplete
                    value={costar}
                    onChange={setCostar}
                    fetchSuggestions={actorFetch}
                    suppressNextOpenSignal={costarHintFillSignal}
                    placeholder="Another actor from that title"
                  />
                </div>
              </div>
              <div className="actions">
                <button type="submit" className="btn btn-primary" disabled={checking || !movie.trim() || !costar.trim()}>
                  {checking ? "Checking…" : "Make the link"}
                </button>
                <UndoButton disabled={undoHistory.length === 0 || checking || hinting} onClick={undoStep} />
              </div>

              <div className="hints">
                <span className="hl">
                  Hints left: <b>{hintsLeft}</b>
                </span>
                <button
                  type="button"
                  className="hint-btn"
                  disabled={hinting || hintsLeft <= 0}
                  onClick={() => void requestHint("movie")}
                  title="Reveal a movie the current actor is in"
                >
                  {activeHintType === "movie" ? (
                    <>
                      <span className="hint-spinner" aria-hidden="true" />
                      Loading…
                    </>
                  ) : (
                    "💡 Movie"
                  )}
                </button>
                <button
                  type="button"
                  className="hint-btn"
                  disabled={hinting || hintsLeft <= 0 || !movie.trim()}
                  onClick={() => void requestHint("actor")}
                  title={movie.trim() ? "Reveal a co-star from that movie" : "Fill in a movie first to unlock this"}
                >
                  {activeHintType === "actor" ? (
                    <>
                      <span className="hint-spinner" aria-hidden="true" />
                      Loading…
                    </>
                  ) : (
                    "💡 Co-star"
                  )}
                </button>
              </div>
              {feedback && <div className={`verify-flash ${feedback.good ? "ok" : "no"}`}>{feedback.text}</div>}
            </form>
          )}
        </>
      )}

      {zoomed && (
        <div className="lightbox" onClick={() => setZoomed(null)}>
          <figure onClick={(event) => event.stopPropagation()}>
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
