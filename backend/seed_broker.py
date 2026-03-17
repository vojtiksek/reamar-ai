from __future__ import annotations

"""
Simple seed script to create a default broker for development.

Usage (from backend directory):

    PYTHONPATH=src python seed_broker.py

It will create (or update) a broker with:
    email: vojtech.sommer@me.com
    password: heslo123
"""

from sqlalchemy import select

from app.db import SessionLocal
from app.models import Broker
from app.main import _hash_password


def main() -> None:
  db = SessionLocal()
  try:
    email = "vojtech.sommer@me.com"
    name = "Vojtěch Sommer"
    password = "heslo123"

    broker = db.execute(select(Broker).where(Broker.email == email)).scalars().first()
    if broker:
      broker.name = name
      broker.password_hash = _hash_password(password)
      print(f"Updated existing broker: {email}")
    else:
      broker = Broker(
        name=name,
        email=email,
        password_hash=_hash_password(password),
        role="broker",
      )
      db.add(broker)
      print(f"Created new broker: {email}")
    db.commit()
  finally:
    db.close()


if __name__ == "__main__":
  main()

