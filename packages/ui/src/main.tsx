import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from './components/error-boundary';
import { App } from './app';
import './styles/global.css';
import './styles/arcade.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Missing #root container in index.html.');
}

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary><App /></ErrorBoundary>
  </StrictMode>,
);
