import { Component, type ErrorInfo, type ReactNode } from 'react';

/** A failed route or unavailable graphics context must never leave a blank page. */
export class ErrorBoundary extends Component<{ readonly children: ReactNode }, { readonly failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override componentDidCatch(_error: Error, _info: ErrorInfo) { /* A hosting platform can attach error reporting here. */ }
  override render() {
    if (!this.state.failed) return this.props.children;
    return <main className="app"><section className="panel"><p className="eyebrow">A SMALL TIMEOUT</p><h1>Let’s get you back in.</h1><p className="lede">Something prevented this page from loading. Refresh to try again.</p><button className="button button--primary" onClick={() => window.location.reload()}>Reload page ↻</button><a className="text-link" href="/">Back to the playground →</a></section></main>;
  }
}
