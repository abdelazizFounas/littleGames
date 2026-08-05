import type { ReactNode } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { HomeRoute } from './routes/home-route';
import { ProfileRoute } from './routes/profile-route';
import { SessionProvider } from './session/session-provider';

export function App(): ReactNode {
  return (
    <SessionProvider>
      <BrowserRouter>
        <main className="app">
          <Routes>
            <Route path="/" element={<HomeRoute />} />
            <Route path="/profile" element={<ProfileRoute />} />
          </Routes>
        </main>
      </BrowserRouter>
    </SessionProvider>
  );
}
