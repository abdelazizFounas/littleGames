import { useContext } from 'react';
import { SessionContext, type SessionContextValue } from './session-context';

/** Reads the session, and fails clearly when used outside the provider. */
export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (value === null) {
    throw new Error('useSession must be used inside a SessionProvider.');
  }
  return value;
}
