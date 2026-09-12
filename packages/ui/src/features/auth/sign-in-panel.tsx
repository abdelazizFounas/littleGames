import { useState, type FormEvent, type ReactNode } from 'react';
import { useAsyncAction } from '../../lib/use-async-action';
import { useSession } from '../../session/use-session';

/**
 * The signed-out screen.
 *
 * Playing as a guest is the primary path and stays a single click: an account
 * is created behind the scenes and can gain an email later, so nobody has to
 * fill a form before their first game.
 */
export function SignInPanel(): ReactNode {
  const { signInAsGuest, signInWithEmail } = useSession();
  const guest = useAsyncAction('The server is unavailable. Please try again shortly.');
  const email = useAsyncAction('Could not sign in with those credentials.');
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [address, setAddress] = useState('');
  const [password, setPassword] = useState('');

  const submitEmail = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    email.run(() => signInWithEmail(address, password));
  };

  return (
    <section className="panel">
      <h1>Get in the game.</h1>
      <p className="lede">Jump in as a guest in one click. Your next rematch can’t wait.</p>

      <button
        type="button"
        className="button button--primary"
        disabled={guest.pending}
        onClick={() => {
          guest.run(signInAsGuest);
        }}
      >
        {guest.pending ? 'Sign in…' : 'Play as guest →'}
      </button>
      {guest.error !== null && <p role="alert" className="error">{guest.error}</p>}

      {showEmailForm ? (
        <form className="form" onSubmit={submitEmail}>
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
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
              }}
            />
          </label>
          <button type="submit" className="button" disabled={email.pending}>
            {email.pending ? 'Sign in…' : 'Sign in'}
          </button>
          {email.error !== null && <p role="alert" className="error">{email.error}</p>}
        </form>
      ) : (
        <button
          type="button"
          className="link-button"
          onClick={() => {
            setShowEmailForm(true);
          }}
        >
          I already have an account
        </button>
      )}
    </section>
  );
}
