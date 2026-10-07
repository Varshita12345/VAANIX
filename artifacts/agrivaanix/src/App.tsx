import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { AuthProvider, useAuth } from '@/lib/auth';
import { Landing, AuthPage, Workspace, HistoryPage, ProfilePage, SettingsPage, HelpPage } from '@/pages/agrivaanix';

const queryClient = new QueryClient();

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const [, navigate] = useLocation();
  if (loading) return <div className="min-h-[100dvh] grid place-items-center"><div className="w-72 space-y-3"><div className="h-3 rounded bg-muted animate-pulse"/><div className="h-8 rounded bg-muted animate-pulse"/><div className="h-3 rounded bg-muted animate-pulse"/></div></div>;
  if (!user) { navigate('/login'); return null; }
  return <>{children}</>;
}
function Router() {
  return <RoutedErrorBoundary><Switch>
    <Route path="/" component={Landing}/>
    <Route path="/login"><AuthPage mode="login"/></Route>
    <Route path="/register"><AuthPage mode="register"/></Route>
    <Route path="/dashboard"><Protected><Workspace/></Protected></Route>
    <Route path="/chat/:id">{(params) => <Protected><Workspace conversationId={params.id}/></Protected>}</Route>
    <Route path="/history"><Protected><HistoryPage/></Protected></Route>
    <Route path="/farm-profile"><Protected><ProfilePage/></Protected></Route>
    <Route path="/settings"><Protected><SettingsPage/></Protected></Route>
    <Route path="/help"><Protected><HelpPage/></Protected></Route>
    <Route component={NotFound}/>
  </Switch></RoutedErrorBoundary>;
}
function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}
function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><AuthProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router/></WouterRouter><Toaster/></AuthProvider></TooltipProvider></QueryClientProvider>;
}
export default App;
