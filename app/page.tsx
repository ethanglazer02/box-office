import Link from "next/link";
import SiteFooter from "./SiteFooter";

function MarqueeBulbs({ count = 20 }: { count?: number }) {
  return (
    <div className="bulbs" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className="bulb" />
      ))}
    </div>
  );
}

export default function Home() {
  return (
    <div className="landing home-landing">
      <MarqueeBulbs />
      <div className="marquee home-marquee">
        <h1 className="wordmark">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/box-office-logo.png" alt="Box Office" className="wordmark-logo" />
          <span className="wordmark-title">Box Office</span>
        </h1>
        <p className="tagline">A movie-connection game</p>
        <p className="hook">
          Connect actors through shared films and chase the lowest box office total with niche picks.
        </p>
        <div className="home-cta-grid">
          <Link href="/daily" className="home-cta home-cta-primary">
            <span className="home-cta-kicker">Today's Challenge</span>
            <span className="home-cta-title">The Daily Reel</span>
            <span className="home-cta-copy">
              Everyone gets the same movie-only matchup today. Beat the field with a lower box office path.
            </span>
          </Link>
          <Link href="/free-play" className="home-cta home-cta-secondary">
            <span className="home-cta-title">Free Play</span>
            <span className="home-cta-copy">
              Choose your own difficulty, reroll fresh pairs, and switch between Movies only and Movies + TV.
            </span>
          </Link>
        </div>
      </div>
      <MarqueeBulbs />
      <SiteFooter />
    </div>
  );
}
