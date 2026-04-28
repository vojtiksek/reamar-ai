"use client";

import { useEffect } from "react";
import { installErrorReporter } from "@/lib/errorReporter";

/**
 * Mounts once at the root layout. Installs global error handlers
 * (window.onerror, unhandledrejection) and a fetch wrapper that reports
 * non-2xx responses + network errors to the backend so they appear in
 * /admin/errors.
 */
export function ErrorReporter() {
  useEffect(() => {
    installErrorReporter();
  }, []);
  return null;
}
