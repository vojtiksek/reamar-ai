"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { GlobalNav } from "@/components/GlobalNav";
import { AppShellV2 } from "./AppShellV2";

type UiVersion = "v1" | "v2";
const STORAGE_KEY = "reamar_ui_version";

// Cesty, které jsou dostupné bez broker tokenu.
const PUBLIC_PATH_PREFIXES = ["/login", "/portal"];

function isPublicPath(pathname: string | null): boolean {
  if (!pathname) return false;
  return PUBLIC_PATH_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

function readInitial(): UiVersion {
  if (typeof window === "undefined") return "v1";
  try {
    const url = new URL(window.location.href);
    const q = url.searchParams.get("ui");
    if (q === "v1" || q === "v2") {
      window.localStorage.setItem(STORAGE_KEY, q);
      return q;
    }
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "v1" || stored === "v2") return stored;
  } catch {
    /* ignore */
  }
  return "v1";
}

export function LayoutSwitcher({ children }: { children: React.ReactNode }) {
  const [version, setVersion] = useState<UiVersion>("v1");
  const [hydrated, setHydrated] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    setVersion(readInitial());
    setHydrated(true);
  }, []);

  // Globální auth guard: pokud broker není přihlášen a není na veřejné stránce,
  // přesměruj na /login?next=... Jinak vykresli obsah.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isPublicPath(pathname)) {
      setAuthChecked(true);
      return;
    }
    const token = window.localStorage.getItem("broker_token");
    if (!token) {
      const next = pathname
        ? `${pathname}${window.location.search || ""}`
        : "/";
      router.replace(`/login?next=${encodeURIComponent(next)}`);
      return;
    }
    setAuthChecked(true);
  }, [pathname, router]);

  useEffect(() => {
    if (!hydrated) return;
    if (typeof document !== "undefined") {
      document.documentElement.dataset.ui = version;
    }
  }, [version, hydrated]);

  const toggle = () => {
    const next: UiVersion = version === "v2" ? "v1" : "v2";
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    setVersion(next);
  };

  // Během auth checku na chráněné stránce nic nerenderuj (brání flashi UI před redirectem).
  if (hydrated && !authChecked && !isPublicPath(pathname)) {
    return null;
  }

  // During SSR / first paint, render v1 shell to match server markup.
  if (!hydrated || version === "v1") {
    return (
      <>
        <div className="app-shell">
          <GlobalNav />
          {children}
        </div>
        {hydrated && (
          <button
            type="button"
            onClick={toggle}
            className="rv2-version-toggle"
            title="Přepnout na nový design"
          >
            <span className="rv2-version-toggle-dot" aria-hidden />
            UI v1 · přepnout na v2
          </button>
        )}
      </>
    );
  }

  return (
    <>
      <AppShellV2>{children}</AppShellV2>
      <button
        type="button"
        onClick={toggle}
        className="rv2-version-toggle"
        title="Vrátit starý design"
      >
        <span className="rv2-version-toggle-dot" aria-hidden />
        UI v2 · zpět na v1
      </button>
    </>
  );
}
