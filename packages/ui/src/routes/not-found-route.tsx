import type { ReactNode } from 'react';
import { Link } from 'react-router';

export function NotFoundRoute(): ReactNode {
  return (
    <section className="panel">
      <p className="eyebrow">404</p>
      <h1>Nothing here</h1>
      <p className="hint">
        That link does not point anywhere. It may have been mistyped, or cut short on its way to
        you.
      </p>
      <Link className="button" to="/">
        Back to the games
      </Link>
    </section>
  );
}
