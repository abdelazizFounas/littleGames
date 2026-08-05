import { displayNameOf } from '@littlegames/net';
import type { ReactNode } from 'react';
import { Link, Navigate } from 'react-router';
import { DisplayNameForm } from '../features/profile/display-name-form';
import { EmailUpgradeForm } from '../features/profile/email-upgrade-form';
import { useSession } from '../session/use-session';

export function ProfileRoute(): ReactNode {
  const { state } = useSession();

  if (state.status === 'loading') {
    return (
      <section className="panel">
        <p className="lede">Loading…</p>
      </section>
    );
  }

  if (state.status === 'signed-out') {
    return <Navigate to="/" replace />;
  }

  const { profile } = state;

  return (
    <section className="panel">
      <p className="eyebrow">Profile</p>
      <h1>{displayNameOf(profile)}</h1>
      <p className="hint">Username: {profile.username}</p>

      <DisplayNameForm profile={profile} />

      {profile.isGuest ? (
        <EmailUpgradeForm />
      ) : (
        <section className="form">
          <h2>Account</h2>
          <p className="hint">Signed in with {profile.email}.</p>
        </section>
      )}

      <Link className="link-button" to="/">
        Back
      </Link>
    </section>
  );
}
