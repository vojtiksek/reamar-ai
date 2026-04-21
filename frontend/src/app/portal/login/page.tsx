"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { API_BASE } from "@/lib/api";

function PortalLoginInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "error" | "success">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = searchParams?.get("token");
    if (!token) {
      setStatus("error");
      setError("Chybí přihlašovací token.");
      return;
    }

    fetch(`${API_BASE}/portal/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          throw new Error(data.detail || "Přihlášení selhalo");
        }
        return r.json();
      })
      .then((data: { session_token: string; client_id: number; client_name: string }) => {
        localStorage.setItem("portal_token", data.session_token);
        localStorage.setItem("portal_client_id", String(data.client_id));
        localStorage.setItem("portal_client_name", data.client_name);
        setStatus("success");
        router.push("/portal");
      })
      .catch((e) => {
        setStatus("error");
        setError(e.message);
      });
  }, [searchParams, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm text-center">
        <h1 className="text-lg font-semibold text-slate-900 mb-4">Reamar AI</h1>
        {status === "loading" && (
          <p className="text-sm text-slate-500">Ověřuji přístup...</p>
        )}
        {status === "error" && (
          <div>
            <p className="text-sm text-rose-600 mb-2">{error}</p>
            <p className="text-xs text-slate-400">
              Odkaz mohl expirovat nebo byl již použit. Kontaktujte svého makléře pro nový odkaz.
            </p>
          </div>
        )}
        {status === "success" && (
          <p className="text-sm text-emerald-600">Přihlášení úspěšné, přesměrovávám...</p>
        )}
      </div>
    </div>
  );
}

export default function PortalLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-50">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm text-center">
            <p className="text-sm text-slate-500">Načítám...</p>
          </div>
        </div>
      }
    >
      <PortalLoginInner />
    </Suspense>
  );
}
