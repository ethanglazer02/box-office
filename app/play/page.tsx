"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
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
  { id: "medium", label: "Medium", blurb: "recognizable faces" },
  { id: "hard", label: "Hard", blurb: "that person from that one movie" }
];

type Mode = "movie" | "all";
const MODES: { id: Mode; label: string }[] = [
  { id: "movie", label: "Movies only" },
  { id: "all", label: "Movies + TV" }
];

type Theme = "light" | "dark";
const THEMES: { id: Theme; label: string }[] = [
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" }
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

const SHARE_TARGETS = [
  { id: "x", label: "X", logo: "https://cdn.simpleicons.org/x/ffffff" },
  { id: "facebook", label: "Facebook", logo: "https://cdn.simpleicons.org/facebook/ffffff" },
  { id: "bluesky", label: "Bluesky", logo: "https://cdn.simpleicons.org/bluesky/ffffff" },
  { id: "whatsapp", label: "WhatsApp", logo: "https://cdn.simpleicons.org/whatsapp/ffffff" },
  { id: "telegram", label: "Telegram", logo: "https://cdn.simpleicons.org/telegram/ffffff" },
  { id: "reddit", label: "Reddit", logo: "https://cdn.simpleicons.org/reddit/ffffff" },
  { id: "messages", label: "Messages", logo: "https://cdn.simpleicons.org/imessage/ffffff" },
  { id: "copy", label: "Copy link", logo: null }
] as const;

function MarqueeLogo() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/box-office-logo.png" alt="" className="brand-logo" aria-hidden="true" />
  );
}

function UndoButton({
  disabled,
  onClick
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
        <path
          d="M9 7L5 11L9 15"
          className="undo-icon-arrow"
        />
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
  const [activeHintType, setActiveHintType] = useState<"movie" | "actor" | null>(null);
  const [movieHintFillSignal, setMovieHintFillSignal] = useState(0);
  const [costarHintFillSignal, setCostarHintFillSignal] = useState(0);
  const [difficulty, setDifficulty] = useState<Difficulty>("easy");
  const [mode, setMode] = useState<Mode>("movie");
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

  // Memoized so the Autocomplete effect doesn't re-fire on unrelated re-renders.
  const titleFetch = useCallback((q: string) => fetchTitleSuggestions(q, mode), [mode]);
  const actorFetch = useCallback((q: string) => fetchActorSuggestions(q), []);

  const current = chain.length ? chain[chain.length - 1].actor : null;
  const stepsUsed = Math.max(0, chain.length - 1);
  const totalGross = chain.reduce((sum, l) => sum + (l.via?.revenue ?? 0), 0);
  const actorHintKey = current ? `${current.id}|${mode}|${normalizeHintKey(movie)}` : "";
  const roundActorIds = chain.map((link) => link.actor.id);

  const syncGameUrl = useCallback((start: Person, nextTarget: Person, diff: Difficulty, nextMode: Mode) => {
    const params = new URLSearchParams();
    params.set("difficulty", diff);
    params.set("mode", nextMode);
    params.set("startId", String(start.id));
    params.set("targetId", String(nextTarget.id));
    window.history.replaceState({}, "", `/play?${params.toString()}`);
  }, []);

  const hydrateSharedRound = useCallback(async (sharedRound: SharedRound) => {
    const res = await fetch(`/api/people?ids=${sharedRound.startId},${sharedRound.targetId}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load shared matchup.");

    const people = Array.isArray(data.results) ? data.results : [];
    const start = people.find((person: Person) => person.id === sharedRound.startId) ?? null;
    const nextTarget = people.find((person: Person) => person.id === sharedRound.targetId) ?? null;
    if (!start || !nextTarget) throw new Error("Shared matchup is no longer available.");

    setDifficulty(sharedRound.difficulty);
    setMode(sharedRound.mode);
    setTarget(nextTarget);
    setChain([{ actor: start, via: null }]);
    setError(null);
    setFeedback(null);
    setStatus("playing");
    setMovie("");
    setCostar("");
    setHintsLeft(3);
    setUsedActorHints({});
    setUndoHistory([]);
    setShareFeedback(null);
    setLoading(false);
    syncGameUrl(start, nextTarget, sharedRound.difficulty, sharedRound.mode);
  }, [syncGameUrl]);

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
    setShareFeedback(null);
    try {
      const res = await fetch(`/api/start?difficulty=${diff}&mode=${m}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start game.");
      setTarget(data.target);
      setChain([{ actor: data.start, via: null }]);
      syncGameUrl(data.start, data.target, diff, m);
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
    let cancelled = false;
    const params = new URLSearchParams(window.location.search);
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

    // Honor ?difficulty= from the homepage links on first load.
    const difficultyParam = params.get("difficulty");
    const modeParam = params.get("mode");
    const startDifficulty: Difficulty =
      difficultyParam === "easy" || difficultyParam === "medium" || difficultyParam === "hard"
        ? difficultyParam
        : "easy";
    const startMode: Mode = modeParam === "movie" || modeParam === "all" ? modeParam : "movie";
    newGame(startDifficulty, startMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => {
      cancelled = true;
    };
  }, [hydrateSharedRound]);

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
              : []
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
      if (type === "movie") {
        setMovie(data.fill);
        setMovieHintFillSignal((n) => n + 1);
      }
      else {
        setCostar(data.fill);
        setCostarHintFillSignal((n) => n + 1);
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
      setActiveHintType(null);
    }
  }

  async function shareWin() {
    if (!target || chain.length === 0) return;
    setShareFeedback(null);
  }

  function getSharePayload(): SharePayload | null {
    if (!target || chain.length === 0) return null;

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
      `🎬 Box Office Challenge\n` +
      `${startActor.name} → ${target.name}\n` +
      `${stepsUsed} ${stepsUsed === 1 ? "step" : "steps"} • ${money(totalGross)} path gross\n` +
      `${difficultyLabel} • ${modeLabel}\n\n` +
      `Think you know nicher movies? Beat my run with a lower box office path.`;

    return {
      title: "Box Office Challenge",
      text,
      url
    };
  }

  function openShareWindow(url: string) {
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function handleShareTarget(targetName: string) {
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
          openShareWindow(`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}&quote=${encodeURIComponent(payload.text)}`);
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
          openShareWindow(`https://www.reddit.com/submit?url=${encodedUrl}&title=${encodeURIComponent(payload.title)}`);
          break;
        case "messages":
          window.location.href = `sms:&body=${encodedMessages}`;
          break;
        case "copy":
          navigator.clipboard.writeText(payload.url);
          setShareFeedback({ text: "Link copied to clipboard.", good: true });
          return;
        default:
          return;
      }

      setShareFeedback({ text: "Share link opened.", good: true });
    } catch {
      setShareFeedback({ text: "Couldn't open that share option.", good: false });
    }
  }

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
          <div className="settings-anchor" ref={settingsRef}>
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

            {showSettings && (
              <div className="settings-panel settings-panel-popover">
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
                <div>
                  <div className="grp-label">Theme</div>
                  <div className="seg">
                  {THEMES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      aria-pressed={theme === t.id}
                      onClick={() => setTheme(t.id)}
                    >
                      {t.label}
                    </button>
                  ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="loading-stage" aria-live="polite" aria-busy="true">
          <div className="loading-marquee" aria-hidden="true">
            <span className="loading-reel" />
            <span className="loading-reel" />
            <span className="loading-reel" />
          </div>
          <div className="loading-copy">
            <div className="loading-kicker">Building Matchup</div>
            <div className="loading-title">Dealing the cast…</div>
            <p className="loading-text">Pulling a fresh start and target from TMDB.</p>
          </div>
        </div>
      ) : error ? (
        <div className="center">
          <p>{error}</p>
          <button onClick={() => newGame()}>Try again</button>
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
              <button type="button" className="btn btn-primary" onClick={() => newGame()}>
                New game
              </button>
            </div>
            <div className="share-inline">
              <div className="share-inline-label">Share your run</div>
              <div className="share-inline-grid">
                {SHARE_TARGETS.map((shareTarget) => (
                  <button
                    key={shareTarget.id}
                    type="button"
                    className={`share-pill share-pill-${shareTarget.id}`}
                    onClick={() => handleShareTarget(shareTarget.id)}
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
              <label>{mode === "movie" ? "Movie" : "Movie or show"}</label>
              <Autocomplete
                value={movie}
                onChange={setMovie}
                fetchSuggestions={titleFetch}
                suppressNextOpenSignal={movieHintFillSignal}
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
              onClick={() => requestHint("movie")}
              title={
                mode === "all"
                  ? "Reveal a movie or TV show the current actor is in"
                  : "Reveal a movie the current actor is in"
              }
            >
              {activeHintType === "movie" ? (
                <>
                  <span className="hint-spinner" aria-hidden="true" />
                  Loading…
                </>
              ) : mode === "all" ? (
                "💡 Movie / TV show"
              ) : (
                "💡 Movie"
              )}
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
          {feedback && (
            <div className={`verify-flash ${feedback.good ? "ok" : "no"}`}>{feedback.text}</div>
          )}
        </form>
      )}
        </>
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
