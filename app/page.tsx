import Link from "next/link";
import SiteFooter from "./SiteFooter";

const LEVELS: { id: string; label: string; tag: string; blurb: string }[] = [
  { id: "easy", label: "Easy", tag: "Matinee", blurb: "Household-name stars and box-office giants." },
  { id: "medium", label: "Medium", tag: "Prime Time", blurb: "Mainstream films with a little more legwork." },
  { id: "hard", label: "Hard", tag: "Last Call", blurb: "Deep cuts and character actors. No mercy." }
];

function MarqueeBulbs({ count = 20 }: { count?: number }) {
  return (
    <div className="bulbs" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="bulb" />
      ))}
    </div>
  );
}

export default function Home() {
  return (
    <div className="landing">
      <MarqueeBulbs />
      <div className="marquee">
        <div className="kicker">Now Showing</div>
        <h1 className="wordmark">
          Box Office
        </h1>
        <p className="hook">
          Link a starting actor to your target through shared movies and shows, then see how low you
          can keep both your path length and total box office.
        </p>
      </div>
      <div className="tickets-row">
        {LEVELS.map((level) => (
          <Link key={level.id} href={`/play?difficulty=${level.id}`} className="ticket-btn">
            <span className="t-grade">{level.tag}</span>
            <span className="t-name">{level.label}</span>
            <span className="t-desc">{level.blurb}</span>
          </Link>
        ))}
      </div>
      <MarqueeBulbs />
      <SiteFooter />
    </div>
  );
}
