import { useState, type ReactNode } from 'react';
import { useAsyncAction } from '../../lib/use-async-action';
import { useSession } from '../../session/use-session';

/** Turns a code into the link a friend can open. */
function linkFor(code: string): string {
  return new URL(`/join/${code}`, window.location.origin).toString();
}

export function InvitePanel({ matchId }: { readonly matchId: string | null }): ReactNode {
  const { createInvitation } = useSession();
  const action = useAsyncAction('Could not create an invitation.');
  const [code, setCode] = useState<string | null>(null);
  const [shared, setShared] = useState<'copied' | null>(null);

  const invite = (): void => {
    setShared(null);
    action.run(async () => {
      setCode((await createInvitation(matchId ?? undefined)).code);
    });
  };

  const share = (link: string): void => {
    setShared(null);
    action.run(async () => {
      // The native sheet where there is one; otherwise the clipboard, which is
      // the only thing every desktop browser agrees on.
      if (typeof navigator.share === 'function') {
        try {
          await navigator.share({ title: 'LittleGames', text: 'Play a game of Pong', url: link });
          return;
        } catch {
          // Dismissing the share sheet rejects. That is not a failure, and
          // falling through to the clipboard leaves the player with the link
          // either way.
        }
      }
      await navigator.clipboard.writeText(link);
      setShared('copied');
    });
  };

  if (code === null) {
    return (
      <div className="invite">
        <button type="button" className="button" disabled={action.pending} onClick={invite}>
          {action.pending ? 'Creating…' : 'Invite a friend'}
        </button>
        {action.error !== null && (
          <p role="alert" className="error">
            {action.error}
          </p>
        )}
      </div>
    );
  }

  const link = linkFor(code);

  return (
    <div className="invite">
      <p className="hint">Send this to whoever you want to play. It works for 30 minutes.</p>
      <p className="hint">
        Testing on your own? A second tab in this browser is the same account, and a match needs
        two. Open the link in a private window or another browser.
      </p>
      <p className="invite__code">{code}</p>
      <div className="actions">
        <button
          type="button"
          className="button button--primary"
          disabled={action.pending}
          onClick={() => {
            share(link);
          }}
        >
          Share the link
        </button>
        <button type="button" className="link-button link-button--inline" onClick={invite}>
          New code
        </button>
      </div>
      <p className="invite__link">{link}</p>
      {shared === 'copied' && <p className="success">Link copied.</p>}
      {action.error !== null && (
        <p role="alert" className="error">
          {action.error}
        </p>
      )}
    </div>
  );
}
