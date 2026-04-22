"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { getSupabase } from "@/lib/supabase";

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextParam = searchParams?.get("next") ?? null;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotMsg, setForgotMsg] = useState<string | null>(null);
  const [forgotLoading, setForgotLoading] = useState(false);

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setError("Zadej email výše a klikni na Zapomenuté heslo znovu.");
      return;
    }
    setForgotLoading(true);
    setForgotMsg(null);
    setError(null);
    const redirectTo =
      typeof window !== "undefined"
        ? `${window.location.origin}/reset-password`
        : undefined;
    const { error: err } = await getSupabase().auth.resetPasswordForEmail(email, {
      redirectTo,
    });
    if (err) {
      setForgotMsg("Nepodařilo se odeslat email.");
    } else {
      setForgotMsg("Email s odkazem pro reset hesla byl odeslán (zkontroluj i spam).");
    }
    setForgotLoading(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const supabase = getSupabase();
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (authError || !data.session) {
        setError("Neplatné přihlašovací údaje");
        setLoading(false);
        return;
      }
      // installBrokerTokenSync() v LayoutSwitcher už synchronizuje broker_token
      // do localStorage přes onAuthStateChange — nemusíme nic ručně ukládat.
      // Bezpečnostní check: povolíme jen interní cesty, ne absolutní URL.
      const target =
        nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//")
          ? nextParam
          : "/clients";
      router.push(target);
    } catch {
      setError("Chyba při přihlášení");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F8F9FA]">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-[0_4px_24px_rgba(0,0,0,0.08)] border border-slate-200">
        <h1 className="mb-6 text-xl font-semibold text-[#1E3A5F]">Přihlášení makléře</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-600">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Heslo</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              required
            />
          </div>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full bg-[#1E3A5F] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#0F2B46] disabled:opacity-50"
          >
            {loading ? "Přihlašuji…" : "Přihlásit se"}
          </button>
        </form>

        <div className="mt-4 text-center">
          {!forgotOpen ? (
            <button
              type="button"
              onClick={() => { setForgotOpen(true); setForgotMsg(null); }}
              className="text-xs text-slate-500 underline hover:text-slate-700"
            >
              Zapomenuté heslo?
            </button>
          ) : (
            <form onSubmit={handleForgot} className="space-y-2 text-left">
              <p className="text-xs text-slate-600">
                Pošleme ti email s odkazem pro nastavení nového hesla na adresu výše.
              </p>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={forgotLoading}
                  className="flex-1 rounded-full bg-slate-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {forgotLoading ? "Odesílám…" : "Poslat reset link"}
                </button>
                <button
                  type="button"
                  onClick={() => setForgotOpen(false)}
                  className="rounded-full border border-slate-300 px-3 py-2 text-xs text-slate-600"
                >
                  Zpět
                </button>
              </div>
              {forgotMsg && <p className="text-xs text-emerald-700">{forgotMsg}</p>}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#F8F9FA]">
          <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm border border-slate-200 text-center">
            <p className="text-sm text-slate-500">Načítám…</p>
          </div>
        </div>
      }
    >
      <LoginInner />
    </Suspense>
  );
}

