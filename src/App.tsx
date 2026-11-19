import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ReactNode, useEffect } from 'react';
import { Layout } from './components/Layout';
import Home from './pages/Home';
import Scan from './pages/Scan';
import Detect from './pages/Detect';
import Pantry from './pages/Pantry';
import Recipes from './pages/Recipes';
import Family from './pages/Family';
import Cook from './pages/Cook';
import Health from './pages/Health';
import Login from './pages/Login';
import { useAuth } from './lib/auth';

/** Kitchen pages need an account once Firebase is configured; without it they stay open. */
function Private({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') {
    return <p className="mx-auto max-w-6xl px-5 py-24 text-center text-muted" role="status">Checking your account…</p>;
  }
  if (status === 'out') return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

export default function App() {
  const location = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  // Pages animate in on mount; no exit-wait, so nested presence animations can never block navigation.
  return (
    <Layout>
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={<Home />} />
        <Route path="/scan" element={<Private><Scan /></Private>} />
        <Route path="/detect" element={<Private><Detect /></Private>} />
        <Route path="/pantry" element={<Private><Pantry /></Private>} />
        <Route path="/recipes" element={<Private><Recipes /></Private>} />
        <Route path="/family" element={<Private><Family /></Private>} />
        <Route path="/cook" element={<Private><Cook /></Private>} />
        <Route path="/health" element={<Private><Health /></Private>} />
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Home />} />
      </Routes>
    </Layout>
  );
}
