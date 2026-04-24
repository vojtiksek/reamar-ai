import { NextResponse } from "next/server";

/**
 * Vercel Cron entry point. Fires daily at 05:00 Europe/Prague (04:00 UTC).
 * Schedule is defined in `vercel.json`.
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` (env var set in
 * Vercel dashboard). We forward the same secret to the FastAPI backend via
 * `x-cron-secret`, and the backend kicks off the pipeline asynchronously.
 *
 * The backend returns immediately with a run_id; the actual 1–5 minute
 * pipeline runs in a background thread and is observable via
 * /admin/operace in the dashboard.
 */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET ?? "";

  if (!cronSecret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET not configured" },
      { status: 500 },
    );
  }

  const token = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7)
    : auth;
  if (token !== cronSecret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const apiBase = process.env.BACKEND_API_URL ?? process.env.NEXT_PUBLIC_API_URL;
  if (!apiBase) {
    return NextResponse.json(
      { ok: false, error: "BACKEND_API_URL not configured" },
      { status: 500 },
    );
  }

  try {
    const res = await fetch(`${apiBase}/admin/ops/daily-run`, {
      method: "POST",
      headers: {
        "x-cron-secret": cronSecret,
        "content-type": "application/json",
      },
      // Backend returns quickly after spawning the thread.
      signal: AbortSignal.timeout(30_000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, status: res.status, backend: body },
        { status: res.status },
      );
    }
    return NextResponse.json({ ok: true, backend: body });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "backend call failed",
      },
      { status: 502 },
    );
  }
}
