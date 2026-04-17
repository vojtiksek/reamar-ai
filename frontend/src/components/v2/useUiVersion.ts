"use client";

import { useEffect, useState } from "react";

export type UiVersion = "v1" | "v2";

export function useUiVersion(): UiVersion {
  const [v, setV] = useState<UiVersion>("v1");

  useEffect(() => {
    if (typeof document === "undefined") return;

    const read = (): UiVersion => {
      const attr = document.documentElement.dataset.ui;
      return attr === "v2" ? "v2" : "v1";
    };

    setV(read());

    const observer = new MutationObserver(() => setV(read()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-ui"],
    });
    return () => observer.disconnect();
  }, []);

  return v;
}
