from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Project root (.env lives here when copied from .env.example)
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
_DEFAULT_DATABASE_URL = "postgresql+psycopg://reamar:reamar_password@localhost:5433/reamar"


class Settings(BaseSettings):
    database_url: str = Field(
        default=_DEFAULT_DATABASE_URL,
        validation_alias="DATABASE_URL",
    )

    model_config = SettingsConfigDict(
        env_file=str(_PROJECT_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()

