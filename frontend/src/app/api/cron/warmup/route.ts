import { NextResponse } from "next/server";

/**
 * Vercel Cron entry point. Fires every 4 minutes.
 * Pings the backend's /health endpoint to keep the Railway container warm.
 *
 * Without this, Railway's hobby tier suspends after ~15 min idle, and the
 * next user request waits 20–40 s for the cold start.
 *
 * Auth: Vercel sends `Authorization: Bearer $CRON_SECRET`. We don't forward
 * anything to the backend — /health is public.
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

  const start = Date.now();
  try {
    const res = await fetch(`${apiBase}/health`, {
      signal: AbortSignal.timeout(45_000),
    });
    return NextResponse.json({
      ok: res.ok,
      status: res.status,
      duration_ms: Date.now() - start,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        duration_ms: Date.now() - start,
        error: err instanceof Error ? err.message : "warmup failed",
      },
      { status: 502 },
    );
  }
}
