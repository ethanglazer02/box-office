export default function CreditsCard() {
  return (
    <div className="credits-card">
      <p className="credits-kicker">Credits</p>
      <h1 className="credits-title">Box Office</h1>
      <p className="credits-copy">
        Box Office uses data provided by The Movie Database for actor, movie, show, and image
        information shown throughout the game.
      </p>

      <section className="credits-section">
        <br></br>
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
          <img src="/tmdb-logo.svg" alt="TMDB" className="tmdb-logo" />
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
      </section>
    </div>
  );
}
