/**
 * Site footer: one rule, two lines, nothing else.
 *
 * No database access, deliberately -- it used to report row counts and coverage,
 * which meant a query on every page render for something the pages already say.
 */
export function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-base">
        {/*
          Not "no outbound requests": with the cloud inbox set up, the drain
          talks to it. The page itself still fetches nothing off this origin,
          which the CSP in next.config.mjs enforces.
        */}
        <span>Stored on this PC &middot; no telemetry</span>
        {/*
          Year comes from the clock rather than a literal, so the notice does not
          quietly go stale on 1 January.
        */}
        <span>&copy; {new Date().getFullYear()} Naimul Nashid &middot; MIT License</span>
      </div>
    </footer>
  );
}
