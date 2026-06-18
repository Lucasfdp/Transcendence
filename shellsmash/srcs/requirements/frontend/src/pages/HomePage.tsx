import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { TempleBackdrop } from '../components/layout/TempleBackdrop';
import { ProtectedRoute } from '../routes/ProtectedRoute';
import { api } from '../hub/api';

function HomeMenu(): JSX.Element {
  const navigate = useNavigate();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    if (isLoggingOut) return;

    setIsLoggingOut(true);
    try {
      await api.logout();
    } catch (err: unknown) {
      console.warn('[HomeMenu] Logout failed, redirecting anyway:', err);
    } finally {
      navigate('/auth', { replace: true });
    }
  };

  return (
    <main className="menu-page">
      <TempleBackdrop pageClassName="menu-page" />

      <section className="menu-page__hero">
        <p className="menu-page__eyebrow">Main Menu</p>
        <h1 className="menu-page__title">Shell Smash</h1>
        <p className="menu-page__description">
          Your session is active. Enter the courtyard and start the first shrine trial.
        </p>
        <div className="menu-page__actions">
          <Link className="menu-page__play-button" to="/game">
            Play
          </Link>
          <button
            className="menu-page__logout-button"
            type="button"
            onClick={handleLogout}
            disabled={isLoggingOut}
          >
            {isLoggingOut ? 'Closing session...' : 'Logout'}
          </button>
        </div>
      </section>
    </main>
  );
}

export function HomePage(): JSX.Element {
  return (
    <ProtectedRoute>
      <HomeMenu />
    </ProtectedRoute>
  );
}
