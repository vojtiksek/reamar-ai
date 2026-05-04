import { NextResponse } from "next/server";

/**
 * Vercel Cron entry point. Fires every 4 minutes.
 *
 * Udržuje warm 2 vrstvy:
 *  1. Railway container (přes /health — bez DB)
 *  2. SQLAlchemy connection pool + Postgres plan cache (přes lehké DB queries)
 *
 * Bez druhé vrstvy: Supabase pooler odstřihne idle connection po ~60 s a
 * první uživatelský request musí re-acquire connection + cold plan cache.
 * Naměřeno na produkci 4. 5. 2026: /brokers/notifications cold = 4.7 s,
 * warm = 572 ms — rozdíl je výhradně cold cache, ne pomalý query plán.
 *
 * Endpointy zde jsou všechny `with_count=false` a `limit=1` ať warmup dělá
 * minimum práce. /filters je explicit vystavena protože probe ji opakovaně
 * timeoutoval (statement_timeout) a warm cache pomáhá držet DISTINCT scan.
 *
 * Auth: Vercel sends `Authorization: Bearer $CRON_SECRET`. Backend endpointy
 * voláme bez auth — všechny zde uvedené jsou veřejné (/health, /filters,
 * /projects, /units listing).
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

  const targets = [
    { name: "health", url: `${apiBase}/health` },
    { name: "filters", url: `${apiBase}/filters` },
    {
      name: "projects",
      url: `${apiBase}/projects?limit=1&offset=0&sort_by=avg_price_per_m2_czk&sort_dir=asc&with_count=false`,
    },
    {
      name: "units",
      url: `${apiBase}/units?limit=1&offset=0&availability=available&with_count=false&with_summary=false`,
    },
  ];

  const start = Date.now();
  // Sériově ne paralelně — pool má 5–10 connections, paralelní 4 requesty by
  // si mezi sebou braly sloty během reálné usage. Sériově = warm-and-release.
  const results: Array<{ name: string; ok: boolean; status: number; ms: number }> = [];
  for (const t of targets) {
    const tStart = Date.now();
    try {
      const res = await fetch(t.url, { signal: AbortSignal.timeout(15_000) });
      results.push({
        name: t.name,
        ok: res.ok,
        status: res.status,
        ms: Date.now() - tStart,
      });
    } catch {
      results.push({
        name: t.name,
        ok: false,
        status: 0,
        ms: Date.now() - tStart,
      });
    }
  }
  const allOk = results.every((r) => r.ok);
  return NextResponse.json(
    {
      ok: allOk,
      duration_ms: Date.now() - start,
      results,
    },
    { status: allOk ? 200 : 502 },
  );
}
