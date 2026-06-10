import Link from "next/link";
import SiteFooter from "./SiteFooter";

const LEVELS: { id: string; label: string; tag: string; blurb: string }[] = [
  { id: "easy", label: "Easy", tag: "Matinee", blurb: "Household-name stars you should know on sight." },
  { id: "medium", label: "Medium", tag: "Prime Time", blurb: "Recognizable faces with trickier filmographies." },
  { id: "hard", label: "Hard", tag: "Last Call", blurb: "\"I know them from something\" actors." }
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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/box-office-logo.png" alt="Box Office" className="wordmark-logo" />
          <span className="wordmark-title">Box Office</span>
        </h1>
        <p className="tagline">A movie-connection game</p>
        <p className="hook">
          Connect actors through shared films and chase the lowest box office total with niche picks.
        </p>
        <p className="hook">
          Anyone can burn through blockbusters. The best runs prove you know the deep cuts.
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
