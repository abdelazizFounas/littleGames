import type { ReactNode } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { AppLayout } from './components/app-layout';
import { ArenaPreviewRoute } from './routes/arena-preview-route';
import { GameLobbyRoute } from './routes/game-lobby-route';
import { HomeRoute } from './routes/home-route';
import { JoinRoute } from './routes/join-route';
import { NotFoundRoute } from './routes/not-found-route';
import { ProfileRoute } from './routes/profile-route';
import { SessionProvider } from './session/session-provider';

export function App(): ReactNode {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<HomeRoute />} />
            <Route path="/games/:gameId" element={<GameLobbyRoute />} />
            <Route path="/join/:code" element={<JoinRoute />} />
            <Route path="/profile" element={<ProfileRoute />} />
            {/* A development-only look at the arena, with nothing networked
                behind it. It is a tool for judging geometry and colour without
                needing two players and a server, and it has no place in a
                build people play on. */}
            {import.meta.env.DEV && (
              <Route path="/preview/arena" element={<ArenaPreviewRoute />} />
            )}
            {/* Catch-all: an unmatched path must say so, never render blank. */}
            <Route path="*" element={<NotFoundRoute />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  );
}
