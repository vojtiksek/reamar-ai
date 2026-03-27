"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { API_BASE } from "@/lib/api";

type StatusValue = "new" | "active" | "shortlist" | "closed";

export default function NewClientPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<StatusValue>("new");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const token =
    typeof window !== "undefined" ? window.localStorage.getItem("broker_token") : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) {
      setError("Nejste přihlášen – prosím přejděte na /login.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/clients`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name,
          email: email || null,
          phone: phone || null,
          status,
          notes: notes || null,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Nepodařilo se vytvořit klienta");
      }
      const client = await res.json();
      router.push(`/clients/${client.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chyba při vytváření klienta");
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="rounded-xl bg-white px-4 py-3 text-sm text-slate-700 shadow">
          Nejste přihlášen. Přejděte na{" "}
          <Link href="/login" className="text-slate-900 underline">
            /login
          </Link>
          .
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-4">
        <div className="mb-4 flex items-center justify-between">
          <nav className="text-xs text-slate-500">
            <Link href="/clients" className="hover:underline">
              Klienti
            </Link>{" "}
            / <span className="text-slate-700">Nový klient</span>
          </nav>
          <button
            type="button"
            onClick={() => router.push("/clients")}
            className="glass-pill border border-transparent px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-white/90"
          >
            Zpět na klienty
          </button>
        </div>
        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <div>
            <label className="block text-xs font-medium text-slate-600">
              Jméno klienta
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              required
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-600">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600">Telefon</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-600">Stav</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as StatusValue)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="new">Nový</option>
                <option value="active">Aktivní</option>
                <option value="shortlist">Shortlist</option>
                <option value="closed">Uzavřený</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Poznámky</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => router.push("/clients")}
              className="rounded-full border border-slate-200 bg-slate-50 px-4 py-1.5 text-xs font-medium text-slate-800 hover:bg-white"
            >
              Zrušit
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-full bg-slate-900 px-4 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
            >
              {loading ? "Vytvářím…" : "Vytvořit klienta"}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}

