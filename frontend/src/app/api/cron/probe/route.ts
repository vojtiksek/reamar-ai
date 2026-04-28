import { NextResponse } from "next/server";

/**
 * Vercel Cron entry point. Fires every 5 minutes.
 * Hits a small set of critical backend endpoints; failures are logged
 * to error_logs (source='probe') and visible in /admin/errors.
 *
 * Auth: Vercel sends `Authorization: Bearer $CRON_SECRET`. We forward
 * the same secret to the backend as `x-cron-secret`.
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
    const res = await fetch(`${apiBase}/admin/probe/run`, {
      method: "POST",
      headers: {
        "x-cron-secret": cronSecret,
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(60_000),
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
