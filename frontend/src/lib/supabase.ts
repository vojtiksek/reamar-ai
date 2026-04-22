"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (_client) return _client;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      "Supabase not configured: set NEXT_PUBLIC_SUPABASE_URL a NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }
  _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // true = auto-detect tokens v URL hashi (potřebné pro reset-password flow)
      detectSessionInUrl: true,
      flowType: "pkce",
      storageKey: "reamar_supabase_auth",
    },
  });
  return _client;
}

/**
 * Kompat vrstva: stávající kód čte `broker_token` z localStorage.
 * Udržujeme ho synchronizovaný s aktuálním Supabase access_tokenem,
 * aby všechny existující fetch() volání zůstaly bez úprav.
 *
 * Voláme při bootu (LayoutSwitcher) — navážeme onAuthStateChange.
 */
export function installBrokerTokenSync(): () => void {
  if (typeof window === "undefined") return () => {};
  const supabase = getSupabase();

  const apply = (session: { access_token: string; user: { user_metadata?: { name?: string }; email?: string } } | null) => {
    try {
      if (session?.access_token) {
        window.localStorage.setItem("broker_token", session.access_token);
        const name = session.user?.user_metadata?.name ?? session.user?.email ?? "";
        window.localStorage.setItem("broker_name", name);
      } else {
        window.localStorage.removeItem("broker_token");
        window.localStorage.removeItem("broker_name");
      }
    } catch {
      /* ignore storage errors */
    }
  };

  // Initial sync z již existující session (pokud jsme přihlášeni z minula).
  supabase.auth.getSession().then(({ data }) => apply(data.session));

  const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
    apply(session);
  });

  return () => sub.subscription.unsubscribe();
}
