import Link from "next/link";
import SiteFooter from "../SiteFooter";

const LEVELS: { id: string; label: string; tag: string; blurb: string }[] = [
  { id: "easy", label: "Easy", tag: "Matinee", blurb: "Household-name stars you should know on sight. (hopefully)" },
  { id: "medium", label: "Medium", tag: "Prime Time", blurb: "Recognizable faces with trickier filmographies." },
  { id: "hard", label: "Hard", tag: "Last Call", blurb: "\"I know them from something\" actors." },
];

function MarqueeBulbs({ count = 20 }: { count?: number }) {
  return (
    <div className="bulbs" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className="bulb" />
      ))}
    </div>
  );
}

export default function FreePlayPage() {
  return (
    <div className="landing landing-free-play">
      <MarqueeBulbs />
      <div className="marquee free-play-marquee">
        <div className="kicker">Free Play</div>
        <h1 className="wordmark">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/box-office-logo.png" alt="Box Office" className="wordmark-logo" />
          <span className="wordmark-title">Cinephile or Casual?</span>
        </h1>
        <p className="tagline">Unlimited runs</p>
        <p className="hook">
          Choose your difficulty, reroll as much as you want, and switch between Movies only and Movies + TV in-game.
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
      <Link href="/daily" className="free-play-backlink">
        Want the shared challenge instead? Play today’s Daily Reel.
      </Link>
      <MarqueeBulbs />
      <SiteFooter />
    </div>
  );
}
