"""Admin broker management endpoints.

Exposes /admin/brokers for listing, inviting, updating, and deleting brokers.
All endpoints require an authenticated broker with role='admin'.

Inviting a broker creates a Supabase Auth user (via Admin API) AND a row in
our `brokers` table. Supabase sends the user a password-setup email. Deleting
a broker removes both records.

Uses SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. These are server-only secrets
(the service-role key bypasses RLS) and must never be shipped to the frontend.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy import select

from .db import get_db_session
from .models import Broker
from .settings import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/brokers", tags=["admin", "brokers"])


# ---------------------------------------------------------------------------
# Auth gate
# ---------------------------------------------------------------------------


def require_admin(
    # Imported lazily to avoid a circular import with main.py (which imports from us).
    broker: Broker = Depends(lambda: None),
) -> Broker:  # pragma: no cover — replaced below
    raise RuntimeError("require_admin not wired — did you forget to override the Depends?")


# Wired at import time by main.py via `admin_brokers.require_admin = _make_require_admin(get_current_broker)`.
# This indirection keeps the router file import-safe before main.py is ready.


def make_require_admin(get_current_broker_dep):
    """Build a dependency that calls `get_current_broker` then checks role=='admin'."""

    def _require_admin(broker: Broker = Depends(get_current_broker_dep)) -> Broker:
        if broker.role != "admin":
            raise HTTPException(status_code=403, detail="Admin access required")
        return broker

    return _require_admin


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class BrokerItem(BaseModel):
    id: int
    name: str
    email: str
    role: str
    supabase_user_id: str | None
    created_at: str


class BrokerCreateBody(BaseModel):
    email: EmailStr
    name: str
    role: str = "broker"  # "broker" | "admin"


class BrokerUpdateBody(BaseModel):
    name: str | None = None
    role: str | None = None


# ---------------------------------------------------------------------------
# Supabase Admin API helpers
# ---------------------------------------------------------------------------


def _supabase_admin_headers() -> dict[str, str]:
    if not settings.supabase_service_role_key:
        raise HTTPException(
            status_code=500,
            detail="Supabase service role key not configured (SUPABASE_SERVICE_ROLE_KEY)",
        )
    return {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "Content-Type": "application/json",
    }


def _supabase_admin_url(path: str) -> str:
    base = (settings.supabase_url or "").rstrip("/")
    if not base:
        raise HTTPException(
            status_code=500,
            detail="Supabase URL not configured (SUPABASE_URL)",
        )
    return f"{base}/auth/v1/admin{path}"


def _supabase_invite_user(email: str, redirect_to: str | None = None) -> dict[str, Any]:
    """Invite a user by email. Supabase sends an invitation email with a
    password-setup link. Returns the created user dict (including `id`)."""
    payload: dict[str, Any] = {"email": email}
    if redirect_to:
        payload["data"] = {}
        payload["redirect_to"] = redirect_to
    with httpx.Client(timeout=15.0) as client:
        resp = client.post(
            _supabase_admin_url("/users"),
            headers=_supabase_admin_headers(),
            json={"email": email, "email_confirm": False},
        )
    if resp.status_code >= 400:
        logger.error("Supabase invite failed: %s %s", resp.status_code, resp.text)
        raise HTTPException(
            status_code=502,
            detail=f"Supabase invite failed ({resp.status_code}): {resp.text[:300]}",
        )
    return resp.json()


def _supabase_send_invite(email: str) -> dict[str, Any]:
    """Send an invite email (calls POST /invite). User created on click."""
    with httpx.Client(timeout=15.0) as client:
        resp = client.post(
            _supabase_admin_url("/invite"),
            headers=_supabase_admin_headers(),
            json={"email": email},
        )
    if resp.status_code >= 400:
        logger.error("Supabase invite email failed: %s %s", resp.status_code, resp.text)
        raise HTTPException(
            status_code=502,
            detail=f"Supabase invite email failed ({resp.status_code}): {resp.text[:300]}",
        )
    return resp.json()


def _supabase_delete_user(user_id: str) -> None:
    with httpx.Client(timeout=15.0) as client:
        resp = client.delete(
            _supabase_admin_url(f"/users/{user_id}"),
            headers=_supabase_admin_headers(),
        )
    if resp.status_code >= 400 and resp.status_code != 404:
        logger.error("Supabase delete failed: %s %s", resp.status_code, resp.text)
        raise HTTPException(
            status_code=502,
            detail=f"Supabase delete failed ({resp.status_code}): {resp.text[:300]}",
        )


# ---------------------------------------------------------------------------
# Route builder (called from main.py once get_current_broker exists)
# ---------------------------------------------------------------------------


def build_routes(get_current_broker_dep) -> APIRouter:
    admin_dep = make_require_admin(get_current_broker_dep)

    @router.get("", response_model=list[BrokerItem])
    def list_brokers(
        _admin: Broker = Depends(admin_dep),
        db=Depends(get_db_session),
    ) -> list[BrokerItem]:
        rows = db.execute(select(Broker).order_by(Broker.created_at.desc())).scalars().all()
        return [
            BrokerItem(
                id=b.id,
                name=b.name,
                email=b.email,
                role=b.role,
                supabase_user_id=b.supabase_user_id,
                created_at=b.created_at.isoformat(),
            )
            for b in rows
        ]

    @router.post("", response_model=BrokerItem, status_code=201)
    def create_broker(
        body: BrokerCreateBody,
        _admin: Broker = Depends(admin_dep),
        db=Depends(get_db_session),
    ) -> BrokerItem:
        if body.role not in {"broker", "admin"}:
            raise HTTPException(status_code=400, detail="role must be 'broker' or 'admin'")

        existing = db.execute(
            select(Broker).where(Broker.email == body.email)
        ).scalars().first()
        if existing:
            raise HTTPException(status_code=409, detail="Broker with this email already exists")

        # 1) Create user in Supabase (no password; invite email sets one).
        user = _supabase_invite_user(body.email)
        supabase_user_id = user.get("id") or user.get("user", {}).get("id")
        if not supabase_user_id:
            raise HTTPException(status_code=502, detail="Supabase did not return a user id")

        # 2) Send invite email (separate call — /invite triggers the email).
        try:
            _supabase_send_invite(body.email)
        except HTTPException:
            # Non-fatal: user exists but email failed. Admin can resend.
            logger.warning("User %s created but invite email failed; admin may resend.", body.email)

        # 3) Mirror into our brokers table.
        # password_hash is legacy (SHA256-salted, unused on Supabase-only accounts).
        # Fill with a placeholder until the column is dropped in Task C.
        broker = Broker(
            name=body.name,
            email=body.email,
            password_hash="supabase-managed",
            supabase_user_id=supabase_user_id,
            role=body.role,
        )
        db.add(broker)
        db.commit()
        db.refresh(broker)

        return BrokerItem(
            id=broker.id,
            name=broker.name,
            email=broker.email,
            role=broker.role,
            supabase_user_id=broker.supabase_user_id,
            created_at=broker.created_at.isoformat(),
        )

    @router.patch("/{broker_id}", response_model=BrokerItem)
    def update_broker(
        broker_id: int,
        body: BrokerUpdateBody,
        admin: Broker = Depends(admin_dep),
        db=Depends(get_db_session),
    ) -> BrokerItem:
        broker = db.execute(select(Broker).where(Broker.id == broker_id)).scalars().first()
        if not broker:
            raise HTTPException(status_code=404, detail="Broker not found")
        if body.name is not None:
            broker.name = body.name
        if body.role is not None:
            if body.role not in {"broker", "admin"}:
                raise HTTPException(status_code=400, detail="role must be 'broker' or 'admin'")
            # Prevent self-demotion to avoid lockout scenarios.
            if broker.id == admin.id and body.role != "admin":
                raise HTTPException(status_code=400, detail="Cannot demote yourself")
            broker.role = body.role
        db.add(broker)
        db.commit()
        db.refresh(broker)
        return BrokerItem(
            id=broker.id,
            name=broker.name,
            email=broker.email,
            role=broker.role,
            supabase_user_id=broker.supabase_user_id,
            created_at=broker.created_at.isoformat(),
        )

    @router.delete("/{broker_id}", status_code=204)
    def delete_broker(
        broker_id: int,
        admin: Broker = Depends(admin_dep),
        db=Depends(get_db_session),
    ) -> None:
        broker = db.execute(select(Broker).where(Broker.id == broker_id)).scalars().first()
        if not broker:
            raise HTTPException(status_code=404, detail="Broker not found")
        if broker.id == admin.id:
            raise HTTPException(status_code=400, detail="Cannot delete yourself")

        # Delete in Supabase first; if that fails, DB row stays and we surface the error.
        if broker.supabase_user_id:
            _supabase_delete_user(broker.supabase_user_id)

        db.delete(broker)
        db.commit()

    @router.post("/{broker_id}/resend-invite", status_code=204)
    def resend_invite(
        broker_id: int,
        _admin: Broker = Depends(admin_dep),
        db=Depends(get_db_session),
    ) -> None:
        broker = db.execute(select(Broker).where(Broker.id == broker_id)).scalars().first()
        if not broker:
            raise HTTPException(status_code=404, detail="Broker not found")
        _supabase_send_invite(broker.email)

    return router
