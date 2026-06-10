"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { API_BASE } from "@/lib/api";

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextParam = searchParams?.get("next") ?? null;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.status === 401) {
        setError("Neplatné přihlašovací údaje");
        setLoading(false);
        return;
      }
      if (!res.ok) {
        setError("Přihlášení se nezdařilo, zkus to prosím znovu.");
        setLoading(false);
        return;
      }
      const data = (await res.json()) as { token: string; name?: string };
      try {
        window.localStorage.setItem("broker_token", data.token);
        window.localStorage.setItem("broker_name", data.name ?? email);
      } catch {
        /* ignore storage errors */
      }
      // Bezpečnostní check: povolíme jen interní cesty, ne absolutní URL.
      const target =
        nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//")
          ? nextParam
          : "/clients";
      router.push(target);
    } catch {
      setError("Chyba při přihlášení");
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F8F9FA]">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-[0_4px_24px_rgba(0,0,0,0.08)] border border-slate-200">
        <h1 className="mb-6 text-xl font-semibold text-[#1E3A5F]">
          Přihlášení makléře
        </h1>

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
