"""Error logging — captures unhandled exceptions and 4xx/5xx responses
into the `error_logs` table. Used by /admin/errors dashboard.

Three sources:
  - 'server'  — backend middleware
  - 'client'  — POST /admin/client-errors from frontend
  - 'probe'   — periodic health check (added by ops_runner)
"""
from __future__ import annotations

import os
import traceback as _tb
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy.orm import Session
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response, JSONResponse

from .db import get_db_session
from .models import ErrorLog


# Paths that should never be logged (avoid feedback loops + noise).
_SKIP_PATHS = {
    "/admin/client-errors",   # the reporter endpoint itself
    "/admin/errors",          # listing
    "/health",
    "/healthz",
    "/",
}

# Truncation limits to keep table bounded.
MAX_MESSAGE_LEN = 4000
MAX_TB_LEN = 16000
MAX_PATH_LEN = 1000
MAX_QUERY_LEN = 2000
MAX_UA_LEN = 500


def _truncate(s: str | None, n: int) -> str | None:
    if s is None:
        return None
    if len(s) <= n:
        return s
    return s[: n - 20] + f"…[+{len(s) - n}]"


def _should_skip(path: str) -> bool:
    if path in _SKIP_PATHS:
        return True
    # Don't log static / docs.
    if path.startswith(("/docs", "/redoc", "/openapi.json", "/favicon")):
        return True
    return False


def write_error(
    db: Session,
    *,
    source: str,
    message: str,
    level: str = "error",
    status: int | None = None,
    method: str | None = None,
    path: str | None = None,
    query: str | None = None,
    traceback: str | None = None,
    user_agent: str | None = None,
    broker_id: int | None = None,
    request_id: str | None = None,
    extra: dict[str, Any] | None = None,
) -> int | None:
    """Insert an error_log row. Best-effort — never raises."""
    try:
        row = ErrorLog(
            source=source,
            level=level,
            status=status,
            method=method,
            path=_truncate(path, MAX_PATH_LEN),
            query=_truncate(query, MAX_QUERY_LEN),
            message=_truncate(message, MAX_MESSAGE_LEN) or "(empty)",
            traceback=_truncate(traceback, MAX_TB_LEN),
            user_agent=_truncate(user_agent, MAX_UA_LEN),
            broker_id=broker_id,
            request_id=request_id,
            extra_json=extra,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return row.id
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
        return None


class ErrorLoggingMiddleware(BaseHTTPMiddleware):
    """Logs unhandled exceptions and >=500 responses to error_logs."""

    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
        path = request.url.path
        method = request.method
        query = request.url.query or None
        ua = request.headers.get("user-agent")

        if _should_skip(path):
            response = await call_next(request)
            return response

        try:
            response: Response = await call_next(request)
        except Exception as exc:  # noqa: BLE001
            tb = _tb.format_exc()
            try:
                with next(get_db_session()) as db:
                    write_error(
                        db,
                        source="server",
                        message=f"{exc.__class__.__name__}: {exc}",
                        status=500,
                        method=method,
                        path=path,
                        query=query,
                        traceback=tb,
                        user_agent=ua,
                        request_id=request_id,
                    )
            except Exception:
                pass
            return JSONResponse(
                status_code=500,
                content={"detail": "Internal Server Error", "request_id": request_id},
            )

        # Log >=500 responses (e.g. raised HTTPException(500), or background failures).
        # 4xx are usually expected (validation, auth) — don't spam.
        if response.status_code >= 500:
            try:
                with next(get_db_session()) as db:
                    write_error(
                        db,
                        source="server",
                        message=f"HTTP {response.status_code} on {method} {path}",
                        status=response.status_code,
                        method=method,
                        path=path,
                        query=query,
                        user_agent=ua,
                        request_id=request_id,
                    )
            except Exception:
                pass
        return response


def cleanup_old_error_logs(db: Session, *, days: int = 14) -> int:
    """Delete error_logs older than `days` days. Returns number of rows deleted."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    from sqlalchemy import delete
    res = db.execute(delete(ErrorLog).where(ErrorLog.ts < cutoff))
    db.commit()
    return res.rowcount or 0


def run_endpoint_probe(
    db: Session,
    *,
    base_url: str,
    endpoints: list[str],
    timeout_s: float = 15.0,
) -> dict:
    """Hit each endpoint with GET and log non-2xx as a 'probe' error.

    Returns a summary dict for the ops dashboard.
    """
    import urllib.request
    import urllib.error

    failed: list[dict] = []
    ok_count = 0
    for ep in endpoints:
        url = base_url.rstrip("/") + ep
        req = urllib.request.Request(url, headers={"User-Agent": "reamar-probe/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=timeout_s) as resp:
                status = resp.status
                if 200 <= status < 400:
                    ok_count += 1
                else:
                    failed.append({"path": ep, "status": status})
                    write_error(
                        db,
                        source="probe",
                        message=f"Probe HTTP {status}",
                        status=status,
                        method="GET",
                        path=ep,
                    )
        except urllib.error.HTTPError as e:
            body = ""
            try:
                body = e.read().decode("utf-8", errors="replace")[:1000]
            except Exception:
                pass
            failed.append({"path": ep, "status": e.code, "body": body})
            write_error(
                db,
                source="probe",
                message=f"Probe HTTP {e.code}: {body[:200]}" if body else f"Probe HTTP {e.code}",
                status=e.code,
                method="GET",
                path=ep,
            )
        except Exception as e:  # noqa: BLE001
            failed.append({"path": ep, "error": str(e)})
            write_error(
                db,
                source="probe",
                message=f"{e.__class__.__name__}: {e}",
                method="GET",
                path=ep,
            )
    return {"ok": ok_count, "failed": failed, "total": len(endpoints)}
