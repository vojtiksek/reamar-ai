from contextlib import contextmanager

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from .settings import settings


def _create_engine() -> Engine:
    return create_engine(settings.database_url, echo=False, future=True)


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

