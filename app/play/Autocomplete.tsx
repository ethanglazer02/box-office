"use client";

import { useEffect, useRef, useState } from "react";

const IMG = "https://image.tmdb.org/t/p/w92";

export interface Suggestion {
  id: number;
  primary: string;
  secondary?: string;
  image?: string | null;
}

export default function Autocomplete({
  value,
  onChange,
  fetchSuggestions,
  placeholder,
  autoFocus,
  disabled
}: {
  value: string;
  onChange: (v: string) => void;
  fetchSuggestions: (q: string) => Promise<Suggestion[]>;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);

  const boxRef = useRef<HTMLDivElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout>>();
  // Guards against out-of-order responses: only the latest query may render.
  const seq = useRef(0);
  // Set right after a selection so the value-change effect doesn't reopen the menu.
  const justPicked = useRef(false);

  useEffect(() => {
    if (justPicked.current) {
      justPicked.current = false;
      return;
    }
    const q = value.trim();
    clearTimeout(debounce.current);
    if (q.length < 2) {
      setItems([]);
      setOpen(false);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    debounce.current = setTimeout(async () => {
      try {
        const results = await fetchSuggestions(q);
        if (mine !== seq.current) return; // a newer query superseded this one
        setItems(results);
        setActive(-1);
        setOpen(results.length > 0);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 220);
    return () => clearTimeout(debounce.current);
  }, [value, fetchSuggestions]);

  // Close when clicking outside.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function pick(s: Suggestion) {
    justPicked.current = true;
    onChange(s.primary);
    setOpen(false);
    setItems([]);
    setActive(-1);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open || items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a <= 0 ? items.length - 1 : a - 1));
    } else if (e.key === "Enter" && active >= 0) {
      // Take the highlighted suggestion instead of submitting the form.
      e.preventDefault();
      pick(items[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="ac" ref={boxRef}>
      <input
        type="text"
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => items.length > 0 && setOpen(true)}
      />
      {open && (
        <ul className="ac-menu">
          {items.map((s, i) => (
            <li
              key={`${s.id}-${i}`}
              className={`ac-item ${i === active ? "active" : ""}`}
              // onMouseDown (not click) so it fires before the input blurs.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(s);
              }}
              onMouseEnter={() => setActive(i)}
            >
              {s.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="ac-thumb" src={IMG + s.image} alt="" />
              ) : null}
              <span className="ac-text">
                <span className="ac-primary">{s.primary}</span>
                {s.secondary && <span className="ac-secondary">{s.secondary}</span>}
              </span>
            </li>
          ))}
          {loading && <li className="ac-loading">Searching…</li>}
        </ul>
      )}
    </div>
  );
}
