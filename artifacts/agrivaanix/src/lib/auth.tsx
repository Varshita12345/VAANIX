import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { useGetAuthConfig, setAuthTokenGetter } from '@workspace/api-client-react';

type AuthValue = { user: User | null; loading: boolean; client: SupabaseClient | null };
const AuthContext = createContext<AuthValue>({ user: null, loading: true, client: null });
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const configQuery = useGetAuthConfig();
  const config = configQuery.data;
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  useEffect(() => {
    if (!config?.supabaseUrl || !config.supabaseAnonKey) return;
    const instance = createClient(config.supabaseUrl, config.supabaseAnonKey);
    setClient(instance);
    setAuthTokenGetter(async () => (await instance.auth.getSession()).data.session?.access_token ?? null);
    instance.auth.getSession().then(({ data }) => { setUser(data.session?.user ?? null); setSessionLoading(false); });
    const { data: listener } = instance.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null); setSessionLoading(false);
    });
    return () => { listener.subscription.unsubscribe(); setAuthTokenGetter(null); };
  }, [config?.supabaseUrl, config?.supabaseAnonKey]);
  const value = useMemo(() => ({ user, client, loading: configQuery.isLoading || sessionLoading }), [user, client, configQuery.isLoading, sessionLoading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
