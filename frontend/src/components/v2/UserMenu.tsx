"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";

export function UserMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState<string>("");
  const [initials, setInitials] = useState<string>("?");
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await getSupabase().auth.getUser();
      if (cancelled) return;
      const em = data.user?.email ?? "";
      setEmail(em);
      setInitials(em ? em.slice(0, 1).toUpperCase() : "?");
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const handleSignOut = async () => {
    await getSupabase().auth.signOut();
    try {
      window.localStorage.removeItem("broker_token");
      window.localStorage.removeItem("broker_name");
    } catch {
      /* ignore */
    }
    router.replace("/login");
  };

  const [refreshing, setRefreshing] = useState(false);
  const handleHardRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      // 1) Drop all service worker registrations so the new bundle isn't
      //    served from sw.js runtime cache on next load.
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      // 2) Wipe Cache Storage (Workbox / sw.js precache + runtime cache).
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      // 3) Hard reload with cache bypass. ?_v=... busts any HTTP cache that
      //    keyed on the bare URL.
      const url = new URL(window.location.href);
      url.searchParams.set("_v", Date.now().toString());
      window.location.replace(url.toString());
    } catch {
      // Even if something above failed, attempt a plain reload so the user
      // isn't stuck in a half-state.
      window.location.reload();
    }
  };

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Uživatelské menu"
        style={{
          width: 32,
          height: 32,
          borderRadius: "50%",
          background: "var(--r-bg-subtle, #E2E8F0)",
          color: "var(--r-text-primary, #1E3A5F)",
          border: "1px solid var(--r-border, #CBD5E1)",
          fontWeight: 600,
          fontSize: 13,
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {initials}
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 8px)",
            minWidth: 220,
            background: "#fff",
            border: "1px solid #E2E8F0",
            borderRadius: 12,
            boxShadow: "0 6px 24px rgba(15,23,42,0.12)",
            padding: 8,
            zIndex: 100,
          }}
        >
          <div style={{ padding: "8px 10px", fontSize: 12, color: "#475569", borderBottom: "1px solid #F1F5F9", marginBottom: 4 }}>
            {email || "—"}
          </div>
          <button
            type="button"
            onClick={handleHardRefresh}
            disabled={refreshing}
            title="Stáhne nejnovější verzi aplikace (vymaže Service Worker + cache)"
            style={{
              width: "100%",
              textAlign: "left",
              padding: "8px 10px",
              fontSize: 13,
              color: "#1E3A5F",
              background: "transparent",
              border: "none",
              borderRadius: 8,
              cursor: refreshing ? "wait" : "pointer",
              opacity: refreshing ? 0.6 : 1,
            }}
            onMouseEnter={(e) => { if (!refreshing) e.currentTarget.style.background = "#F1F5F9"; }}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            {refreshing ? "Aktualizuji…" : "↻ Aktualizovat aplikaci"}
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            style={{
              width: "100%",
              textAlign: "left",
              padding: "8px 10px",
              fontSize: 13,
              color: "#E11D48",
              background: "transparent",
              border: "none",
              borderRadius: 8,
              cursor: "pointer",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#FEF2F2")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            Odhlásit se
          </button>
        </div>
      )}
    </div>
  );
}
