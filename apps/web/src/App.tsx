import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './store/auth';
import { onUnauthenticated } from './lib/api';
import { LoginScreen, SetupScreen } from './routes/Auth';
import { Layout } from './components/Layout';
import { ConfirmHost, Toaster, VaultPrompt } from './components/ui';
import { RackPage } from './routes/RackPage';

const InventoryPage = lazy(() => import('./routes/InventoryPage'));
const TopologyPage = lazy(() => import('./routes/TopologyPage'));
const DocsPage = lazy(() => import('./routes/DocsPage'));
const ProjectsPage = lazy(() => import('./routes/ProjectsPage'));
const AuditPage = lazy(() => import('./routes/AuditPage'));
const SettingsPage = lazy(() => import('./routes/SettingsPage'));

function Loading() {
  return <div className="flex h-full items-center justify-center text-sm text-ink-2" role="status">Loading…</div>;
}

export function App() {
  const { phase, init, expired } = useAuth();
  useEffect(() => {
    init().catch(() => useAuth.setState({ phase: 'login' }));
    return onUnauthenticated(() => expired());
  }, [init, expired]);

  if (phase === 'loading') return <div className="h-screen"><Loading /></div>;
  if (phase === 'setup') return <><SetupScreen /><Toaster /></>;
  if (phase === 'login') return <><LoginScreen /><Toaster /></>;

  return (
    <BrowserRouter>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<InventoryPage />} />
            <Route path="rack" element={<RackPage />} />
            <Route path="inventory" element={<Navigate to="/" replace />} />
            <Route path="topology" element={<TopologyPage />} />
            <Route path="docs" element={<DocsPage />} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
      <ConfirmHost />
      <VaultPrompt />
      <Toaster />
    </BrowserRouter>
  );
}
