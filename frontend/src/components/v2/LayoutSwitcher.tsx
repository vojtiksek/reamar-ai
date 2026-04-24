"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppShellV2 } from "./AppShellV2";
import { getSupabase, installBrokerTokenSync } from "@/lib/supabase";

// Cesty, které jsou dostupné bez broker tokenu.
const PUBLIC_PATH_PREFIXES = ["/login", "/portal", "/reset-password"];

function isPublicPath(pathname: string | null): boolean {
  if (!pathname) return false;
  return PUBLIC_PATH_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export function LayoutSwitcher({ children }: { children: React.ReactNode }) {
  const [authChecked, setAuthChecked] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    // Start Supabase → localStorage token sync (kompat pro existující fetche).
    const unsub = installBrokerTokenSync();
    return () => {
      try { unsub(); } catch { /* ignore */ }
    };
  }, []);

  // Globální auth guard: čeká na Supabase session (async).
  // Pokud broker není přihlášen a není na veřejné stránce → /login?next=...
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isPublicPath(pathname)) {
      setAuthChecked(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await getSupabase().auth.getSession();
        if (cancelled) return;
        if (!data.session) {
          const next = pathname
            ? `${pathname}${window.location.search || ""}`
            : "/";
          router.replace(`/login?next=${encodeURIComponent(next)}`);
          return;
        }
        setAuthChecked(true);
      } catch {
        if (!cancelled) {
          router.replace("/login");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [pathname, router]);

  // Během auth checku na chráněné stránce nic nerenderuj (brání flashi UI před redirectem).
  if (!authChecked && !isPublicPath(pathname)) {
    return null;
  }

  return <AppShellV2>{children}</AppShellV2>;
}
