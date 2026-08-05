import { useState, type FormEvent, type ReactNode } from 'react';
import { useAsyncAction } from '../../lib/use-async-action';
import { useSession } from '../../session/use-session';

/**
 * Turns a guest account into one that can be signed into from anywhere.
 *
 * This links credentials to the existing account rather than creating a new
 * one, so the player keeps their id, their name and everything attached to
 * them.
 */
export function EmailUpgradeForm(): ReactNode {
  const { upgradeToEmailAccount } = useSession();
  const action = useAsyncAction('Could not add that email address.');
  const [address, setAddress] = useState('');
  const [password, setPassword] = useState('');

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    action.run(() => upgradeToEmailAccount(address, password));
  };

  return (
    <form className="form" onSubmit={submit}>
      <h2>Secure your account</h2>
      <p className="hint">
        Right now this account only exists on this device. Add an email address to sign in from
        anywhere and stop relying on this browser.
      </p>
      <label className="field">
        <span>Email</span>
        <input
          type="email"
          autoComplete="email"
          required
          value={address}
          onChange={(event) => {
            setAddress(event.target.value);
          }}
        />
      </label>
      <label className="field">
        <span>Password</span>
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
        />
      </label>
      <button type="submit" className="button" disabled={action.pending}>
        {action.pending ? 'Linking…' : 'Add email'}
      </button>
      {action.error !== null && <p role="alert" className="error">{action.error}</p>}
    </form>
  );
}
