"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function SiteFooter() {
  const pathname = usePathname();
  const showHomeLink = pathname !== "/";
  const showThemeToggle = pathname !== "/play" && pathname !== "/daily";
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
  }, []);

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;

    try {
      window.localStorage.setItem("box-office-theme", nextTheme);
    } catch {}
  }

  return (
    <footer className="site-footer">
      {showThemeToggle ? (
        <>
          <button type="button" className="site-footer-theme" onClick={toggleTheme}>
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
          <span className="site-footer-sep" aria-hidden="true">
            ·
          </span>
        </>
      ) : null}
      {showHomeLink ? (
        <>
          <Link href="/" prefetch={false} className="site-footer-link">
            Home
          </Link>
          <span className="site-footer-sep" aria-hidden="true">
            ·
          </span>
        </>
      ) : null}
      <Link href="/how-to-play" prefetch={false} className="site-footer-link">
        How to Play
      </Link>
      <span className="site-footer-sep" aria-hidden="true">
        ·
      </span>
      <Link href="/credits" prefetch={false} className="site-footer-link">
        Credits
      </Link>
    </footer>
  );
}
