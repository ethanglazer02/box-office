export default function HowToPlayCard() {
  return (
    <div className="credits-card">
      <p className="credits-kicker">Guide</p>
      <h1 className="credits-title">How to Play</h1>
      <p className="credits-copy">
        Connect two actors through shared films. Can you keep your path short and your box office total low.
      </p>
      <br></br>
      <section className="credits-section">
        <h2>The Rules</h2>
        <ol className="htp-steps">
          <li>You see a <strong>Start</strong> actor and a <strong>Target</strong> actor.</li>
          <li>Name a <strong>film</strong> the current actor appeared in, and a <strong>co-star</strong> from that same film.</li>
          <li>If both check out, the co-star becomes your new current actor.</li>
          <li>Keep going until your co-star <em>is</em> the target — that&apos;s a win.</li>
        </ol>
      </section>

      <section className="credits-section">
        <h2>Scoring</h2>
        <p className="credits-copy">
          A running box office total tracks the films in your path.
          The goal is a short path <em>and</em> a low total. Can you skip the blockbusters and find the deep cuts?
          Anyone can bridge actors through billion-dollar tentpoles. The best runs prove you know ball.
        </p>
      </section>

      <section className="credits-section">
        <h2>Hints</h2>
        <p className="credits-copy">
          You get <strong>3 hints </strong> per game. One reveals a film the current actor appeared in.
          The other reveals a co-star once you&apos;ve named a film. Each hint uses one from your total.
        </p>
      </section>
    </div>
  );
}
