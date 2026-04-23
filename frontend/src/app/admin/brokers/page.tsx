"use client";

import { useEffect, useState } from "react";

import { API_BASE } from "@/lib/api";

type BrokerItem = {
  id: number;
  name: string;
  email: string;
  role: "broker" | "admin";
  supabase_user_id: string | null;
  created_at: string;
};

type Phase = "loading" | "ready" | "forbidden" | "error";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem("broker_token");
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token ?? ""}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (res.status === 403) {
    const err = new Error("forbidden");
    (err as Error & { status?: number }).status = 403;
    throw err;
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
}

export default function AdminBrokersPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [rows, setRows] = useState<BrokerItem[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  // Create form
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"broker" | "admin">("broker");
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState<string | null>(null);

  const load = async () => {
    try {
      const data = await api<BrokerItem[]>("/admin/brokers");
      setRows(data);
      setPhase("ready");
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 403) {
        setPhase("forbidden");
      } else {
        setErrorMsg(err.message || "Nepodařilo se načíst brokery.");
        setPhase("error");
      }
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateMsg(null);
    if (!email || !name) {
      setCreateMsg("Vyplň email i jméno.");
      return;
    }
    setCreating(true);
    try {
      await api<BrokerItem>("/admin/brokers", {
        method: "POST",
        body: JSON.stringify({ email, name, role }),
      });
      setEmail("");
      setName("");
      setRole("broker");
      setCreateMsg("Broker vytvořen. Pozvánka odeslána emailem.");
      await load();
    } catch (e) {
      setCreateMsg((e as Error).message || "Nepodařilo se vytvořit brokera.");
    } finally {
      setCreating(false);
    }
  };

  const handleRoleChange = async (b: BrokerItem, newRole: "broker" | "admin") => {
    if (b.role === newRole) return;
    setBusyId(b.id);
    try {
      await api<BrokerItem>(`/admin/brokers/${b.id}`, {
        method: "PATCH",
        body: JSON.stringify({ role: newRole }),
      });
      await load();
    } catch (e) {
      alert((e as Error).message || "Nepodařilo se změnit roli.");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (b: BrokerItem) => {
    if (!confirm(`Opravdu smazat brokera ${b.email}? Bude odstraněn ze Supabase Auth i z databáze.`)) {
      return;
    }
    setBusyId(b.id);
    try {
      await api<void>(`/admin/brokers/${b.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      alert((e as Error).message || "Nepodařilo se smazat brokera.");
    } finally {
      setBusyId(null);
    }
  };

  const handleResend = async (b: BrokerItem) => {
    setBusyId(b.id);
    try {
      await api<void>(`/admin/brokers/${b.id}/resend-invite`, { method: "POST" });
      alert("Pozvánka znovu odeslána.");
    } catch (e) {
      alert((e as Error).message || "Nepodařilo se odeslat pozvánku.");
    } finally {
      setBusyId(null);
    }
  };

  if (phase === "loading") {
    return <p className="text-sm text-slate-500">Načítám…</p>;
  }
  if (phase === "forbidden") {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        Nemáš přístup k této stránce. Vyžaduje se role <strong>admin</strong>.
      </div>
    );
  }
  if (phase === "error") {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        Chyba: {errorMsg}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Create form */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Pozvat nového brokera</h2>
        <form onSubmit={handleCreate} className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_150px_auto]">
          <input
            type="email"
            placeholder="email@domena.cz"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            required
          />
          <input
            type="text"
            placeholder="Jméno"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            required
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "broker" | "admin")}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="broker">broker</option>
            <option value="admin">admin</option>
          </select>
          <button
            type="submit"
            disabled={creating}
            className="rounded-full bg-[#1E3A5F] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0F2B46] disabled:opacity-50"
          >
            {creating ? "Posílám…" : "Pozvat"}
          </button>
        </form>
        {createMsg && (
          <p className="mt-2 text-xs text-slate-600">{createMsg}</p>
        )}
        <p className="mt-2 text-xs text-slate-500">
          Supabase pošle pozvánku emailem s odkazem na nastavení hesla.
        </p>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Jméno</th>
              <th className="px-3 py-2 text-left font-medium">Email</th>
              <th className="px-3 py-2 text-left font-medium">Role</th>
              <th className="px-3 py-2 text-left font-medium">Supabase ID</th>
              <th className="px-3 py-2 text-left font-medium">Vytvořeno</th>
              <th className="px-3 py-2 text-right font-medium">Akce</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-400">
                  Zatím žádní brokeři.
                </td>
              </tr>
            )}
            {rows.map((b) => (
              <tr key={b.id} className={busyId === b.id ? "opacity-50" : ""}>
                <td className="px-3 py-2 font-medium text-slate-900">{b.name}</td>
                <td className="px-3 py-2 text-slate-700">{b.email}</td>
                <td className="px-3 py-2">
                  <select
                    value={b.role}
                    onChange={(e) => handleRoleChange(b, e.target.value as "broker" | "admin")}
                    disabled={busyId === b.id}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                  >
                    <option value="broker">broker</option>
                    <option value="admin">admin</option>
                  </select>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500">
                  {b.supabase_user_id?.slice(0, 8) ?? "—"}
                  {b.supabase_user_id ? "…" : ""}
                </td>
                <td className="px-3 py-2 text-xs text-slate-500">
                  {new Date(b.created_at).toLocaleDateString("cs-CZ")}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => handleResend(b)}
                    disabled={busyId === b.id || !b.supabase_user_id}
                    className="mr-2 rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-30"
                    title="Znovu odeslat pozvánku"
                  >
                    Resend
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(b)}
                    disabled={busyId === b.id}
                    className="rounded-md px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-30"
                  >
                    Smazat
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
