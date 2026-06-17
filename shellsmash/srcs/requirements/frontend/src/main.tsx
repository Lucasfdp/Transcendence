import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import './styles.css';

const GamePage = React.lazy(() => import('./routes/GamePage'));

function HomePage(): JSX.Element {
  return (
    <Link to="/game">
      <button type="button">Play</button>
    </Link>
  );
}

function App(): JSX.Element {
  return (
    <BrowserRouter>
      <Suspense
        fallback={
          <div className="route-loading">
            <span className="route-loading-badge">Loading route</span>
          </div>
        }
      >
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/game" element={<GamePage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
