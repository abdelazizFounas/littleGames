import type { PlayerProfile } from '@littlegames/net';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useAsyncAction } from '../../lib/use-async-action';
import { useSession } from '../../session/use-session';

export function DisplayNameForm({ profile }: { readonly profile: PlayerProfile }): ReactNode {
  const { changeDisplayName } = useSession();
  const action = useAsyncAction('Could not save your name.');
  const [name, setName] = useState(profile.displayName ?? '');
  const [saved, setSaved] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setSaved(false);
    action.run(async () => {
      await changeDisplayName(name.trim());
      setSaved(true);
    });
  };

  return (
    <form className="form" onSubmit={submit}>
      <h2>Display name</h2>
      <label className="field">
        <span>This is the name other players see.</span>
        <input
          type="text"
          maxLength={64}
          required
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setSaved(false);
          }}
        />
      </label>
      <button type="submit" className="button" disabled={action.pending || name.trim().length === 0}>
        {action.pending ? 'Saving…' : 'Save'}
      </button>
      {action.error !== null && <p role="alert" className="error">{action.error}</p>}
      {saved && action.error === null && <p className="success">Name updated.</p>}
    </form>
  );
}
