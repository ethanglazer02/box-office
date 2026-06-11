"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function SiteFooter() {
  const pathname = usePathname();
  const showHomeLink = pathname !== "/";

  return (
    <footer className="site-footer">
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
