"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { getSupabase } from "@/lib/supabase";

type Phase = "checking" | "ready" | "saving" | "done" | "no-session";

function ResetPasswordInner() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Supabase při detectSessionInUrl:true parsuje tokeny z hashe a vytvoří
  // dočasnou session. Ověříme, že ji máme.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await getSupabase().auth.getSession();
        if (cancelled) return;
        setPhase(data.session ? "ready" : "no-session");
      } catch {
        if (!cancelled) setPhase("no-session");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Heslo musí mít alespoň 8 znaků.");
      return;
    }
    if (password !== password2) {
      setError("Hesla se neshodují.");
      return;
    }
    setPhase("saving");
    const { error: err } = await getSupabase().auth.updateUser({ password });
    if (err) {
      setError(err.message || "Nepodařilo se nastavit heslo.");
      setPhase("ready");
      return;
    }
    setPhase("done");
    setTimeout(() => {
      router.push("/clients");
    }, 1500);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F8F9FA]">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-[0_4px_24px_rgba(0,0,0,0.08)] border border-slate-200">
        <h1 className="mb-6 text-xl font-semibold text-[#1E3A5F]">Nastavení nového hesla</h1>

        {phase === "checking" && (
          <p className="text-sm text-slate-500">Ověřuji platnost odkazu…</p>
        )}

        {phase === "no-session" && (
          <div className="space-y-3">
            <p className="text-sm text-rose-600">
              Odkaz je neplatný nebo vypršel. Požádej o nový na přihlašovací stránce.
            </p>
            <button
              type="button"
              onClick={() => router.push("/login")}
              className="w-full rounded-full bg-[#1E3A5F] px-4 py-2.5 text-sm font-semibold text-white"
            >
              Zpět na přihlášení
            </button>
          </div>
        )}

        {(phase === "ready" || phase === "saving") && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-600">Nové heslo</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                required
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600">Potvrzení hesla</label>
              <input
                type="password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                minLength={8}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                required
              />
            </div>
            {error && <p className="text-sm text-rose-600">{error}</p>}
            <button
              type="submit"
              disabled={phase === "saving"}
              className="w-full rounded-full bg-[#1E3A5F] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0F2B46] disabled:opacity-50"
            >
              {phase === "saving" ? "Ukládám…" : "Nastavit heslo"}
            </button>
          </form>
        )}

        {phase === "done" && (
          <p className="text-sm text-emerald-700">
            Heslo bylo změněno. Přesměrování…
          </p>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
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
      <ResetPasswordInner />
    </Suspense>
  );
}
