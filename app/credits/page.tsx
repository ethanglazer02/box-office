import Link from "next/link";

const TMDB_LOGO =
  "https://www.themoviedb.org/assets/2/v4/logos/v2/stacked-green-ac73db0855fd1eeaf4f6cb6b9091f7d1a1ee7e6bb0bce8e7afdac857c13a7d32.svg";

export default function CreditsPage() {
  return (
    <main className="credits-page">
      <div className="credits-card">
        <p className="credits-kicker">Credits</p>
        <h1 className="credits-title">Box Office</h1>
        <p className="credits-copy">
          Box Office uses data provided by The Movie Database for actor, movie, show, and image
          information shown throughout the game.
        </p>

        <section className="credits-section">
          <h2>TMDB Attribution</h2>
          <p className="credits-notice">
            This product uses the TMDB API but is not endorsed or certified by TMDB.
          </p>
          <a
            className="tmdb-badge"
            href="https://www.themoviedb.org"
            target="_blank"
            rel="noreferrer"
            aria-label="Visit The Movie Database"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={TMDB_LOGO} alt="TMDB" className="tmdb-logo" />
          </a>
          <p className="credits-copy credits-copy-tight">
            TMDB name and logo are used here only to identify the source of API data. The logo is
            shown less prominently than the Box Office branding and does not imply endorsement.
          </p>
        </section>

        <section className="credits-section">
          <h2>Links</h2>
          <p className="credits-copy credits-copy-tight">
            TMDB website:{" "}
            <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer">
              themoviedb.org
            </a>
          </p>
          <p className="credits-copy credits-copy-tight">
            TMDB logos and attribution guidance:{" "}
            <a
              href="https://www.themoviedb.org/about/logos-attribution"
              target="_blank"
              rel="noreferrer"
            >
              themoviedb.org/about/logos-attribution
            </a>
          </p>
        </section>

        <div className="credits-actions">
          <Link href="/">Home</Link>
          <Link href="/play">Play</Link>
        </div>
      </div>
    </main>
  );
}
