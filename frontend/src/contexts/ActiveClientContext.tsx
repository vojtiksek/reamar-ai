"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { CurrentFilters } from "@/lib/filters";

const SESSION_KEY = "reamar_active_client";

export type ActiveClientData = {
  clientId: number;
  clientName: string;
  derivedFilters: CurrentFilters;
  /** Raw GeoJSON string from client profile, used to initialize polygon on /projects/map. */
  polygonGeoJson?: string | null;
};

type ActiveClientContextValue = {
  activeClient: ActiveClientData | null;
  activate: (data: ActiveClientData) => void;
  deactivate: () => void;
};

const ActiveClientContext = createContext<ActiveClientContextValue>({
  activeClient: null,
  activate: () => {},
  deactivate: () => {},
});

export function ActiveClientProvider({ children }: { children: ReactNode }) {
  const [activeClient, setActiveClient] = useState<ActiveClientData | null>(null);

  // Restore from sessionStorage on mount (survives page navigations, cleared on tab close).
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) setActiveClient(JSON.parse(raw) as ActiveClientData);
    } catch {
      // ignore — corrupted entry
    }
  }, []);

  const activate = useCallback((data: ActiveClientData) => {
    setActiveClient(data);
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
    } catch {
      // ignore
    }
  }, []);

  const deactivate = useCallback(() => {
    setActiveClient(null);
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // ignore
    }
  }, []);

  return (
    <ActiveClientContext.Provider value={{ activeClient, activate, deactivate }}>
      {children}
    </ActiveClientContext.Provider>
  );
}

export function useActiveClient(): ActiveClientContextValue {
  return useContext(ActiveClientContext);
}
