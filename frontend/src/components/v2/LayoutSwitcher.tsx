"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppShellV2 } from "./AppShellV2";

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

  // Globální auth guard: čte broker_token z localStorage (backend /auth/login).
  // Pokud broker není přihlášen a není na veřejné stránce → /login?next=...
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isPublicPath(pathname)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAuthChecked(true);
      return;
    }
    let token: string | null = null;
    try {
      token = window.localStorage.getItem("broker_token");
    } catch {
      token = null;
    }
    if (!token) {
      const next = pathname
        ? `${pathname}${window.location.search || ""}`
        : "/";
      router.replace(`/login?next=${encodeURIComponent(next)}`);
      return;
    }
    setAuthChecked(true);
  }, [pathname, router]);

  // Během auth checku na chráněné stránce nic nerenderuj (brání flashi UI před redirectem).
  if (!authChecked && !isPublicPath(pathname)) {
    return null;
  }

  return <AppShellV2>{children}</AppShellV2>;
}
