import {
  createContext, useCallback, useContext, useEffect, useState, type ReactNode,
} from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getClient, isAuthFailure, signOut, supabase } from "./supabase";

/**
 * The signed-in user's organisation, resolved ONCE for the whole app.
 *
 * Every screen used to run its own
 * `from("organizations").select("id").limit(1)` before its real query — nine
 * screens, each paying two sequential round trips on a phone connection every
 * time a tab was opened. The org does not change while the app is running, so
 * it is fetched here and shared.
 */

interface OrgValue {
  orgId: string | null;
  orgName: string;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

const OrgContext = createContext<OrgValue>({
  orgId: null, orgName: "", loading: true, error: null, reload: () => {},
});

export function OrgProvider({ children }: { children: ReactNode }) {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const client = await getClient();
        const { data, error: qError } = await client
          .from("organizations").select("id,name").limit(1);
        if (cancelled) return;
        if (qError) throw qError;
        if (!data?.length) throw new Error("No organization visible to this user");
        setOrgId(data[0].id);
        setOrgName(data[0].name);
      } catch (e) {
        if (cancelled) return;
        /*
         * An expired session is not a data error. Signing out flips the gate in
         * App.tsx to the sign-in screen, which is what the user needs, instead
         * of stranding them on "Could not load: Not signed in." with no way
         * back.
         */
        if (isAuthFailure(e)) { void signOut(); return; }
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  return (
    <OrgContext.Provider value={{ orgId, orgName, loading, error, reload }}>
      {children}
    </OrgContext.Provider>
  );
}

export function useOrg(): OrgValue {
  return useContext(OrgContext);
}

export interface DataState<T> {
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  data: T | null;
  reload: () => void;
  onRefresh: () => void;
}

/**
 * Fetch a screen's data against the shared organisation.
 *
 * Replaces the per-screen useOrgData, which resolved the org itself. The
 * fetcher signature is unchanged so screens did not have to be rewritten.
 */
export function useOrgData<T>(
  fetcher: (client: SupabaseClient, orgId: string) => Promise<T>,
): DataState<T> {
  const { orgId, loading: orgLoading, error: orgError, reload: reloadOrg } = useOrg();

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (orgLoading) return;
    if (orgError) { setError(orgError); setLoading(false); return; }
    if (!orgId) return;

    let cancelled = false;
    (async () => {
      try {
        setError(null);
        const client = await getClient();
        const result = await fetcher(client, orgId);
        if (!cancelled) setData(result);
      } catch (e) {
        if (cancelled) return;
        if (isAuthFailure(e)) { void signOut(); return; }
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) { setLoading(false); setRefreshing(false); }
      }
    })();
    return () => { cancelled = true; };
    // `fetcher` is defined at module scope per screen and never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, orgLoading, orgError, attempt]);

  const reload = useCallback(() => {
    setLoading(true);
    // If the org itself failed, retrying the query alone would fail the same
    // way. Retry from the top.
    if (orgError) reloadOrg();
    setAttempt((n) => n + 1);
  }, [orgError, reloadOrg]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setAttempt((n) => n + 1);
  }, []);

  return {
    loading: loading || orgLoading,
    refreshing,
    error,
    data,
    reload,
    onRefresh,
  };
}
