from contextlib import contextmanager

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from .settings import settings


def _create_engine() -> Engine:
    # If we're connecting through PgBouncer (Supabase Transaction pooler on port 6543),
    # disable server-side prepared statements — transaction pooling doesn't support them.
    connect_args: dict = {}
    if "pooler.supabase.com" in settings.database_url or ":6543" in settings.database_url:
        connect_args["prepare_threshold"] = None

    # Hard statement timeout so a stuck query surfaces as an error instead of a silent
    # infinite hang (observed during BuiltMind import, chunk 14 batch_load_units).
    # 120 s is generous for our biggest batch queries but catches real stalls.
    # psycopg accepts libpq "options" to pass session-level SET commands.
    existing_options = connect_args.get("options", "")
    timeout_option = "-c statement_timeout=120000 -c lock_timeout=30000 -c idle_in_transaction_session_timeout=60000"
    connect_args["options"] = (existing_options + " " + timeout_option).strip()

    # TCP keepalives: Supavisor (Supabase pooler) sometimes silently drops connections
    # and the kernel never notices. Without keepalives, recv() hangs forever.
    # With these, kernel probes after 30 s idle; 3 failed probes (30 s apart) close the socket.
    connect_args.setdefault("keepalives", 1)
    connect_args.setdefault("keepalives_idle", 30)
    connect_args.setdefault("keepalives_interval", 10)
    connect_args.setdefault("keepalives_count", 3)
    # tcp_user_timeout (Linux): max time a segment can be unacked before the kernel closes.
    # 60 s — dead TCP connection surfaces within ~1 min instead of forever.
    connect_args.setdefault("tcp_user_timeout", 60000)

    return create_engine(
        settings.database_url,
        echo=False,
        future=True,
        pool_size=10,
        max_overflow=20,
        pool_pre_ping=True,
        pool_recycle=300,
        connect_args=connect_args,
    )


engine: Engine = _create_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


@contextmanager
def get_db() -> Session:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def check_db_connection() -> None:
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))


def get_db_session() -> Session:
    """FastAPI dependency-style DB session generator."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

