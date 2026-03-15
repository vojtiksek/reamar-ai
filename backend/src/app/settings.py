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
    # Optional paths for location source refresh (admin job). If set, refresh-and-recompute can load from these.
    location_source_noise_day_path: str | None = Field(default=None, validation_alias="LOCATION_SOURCE_NOISE_DAY_PATH")
    location_source_noise_night_path: str | None = Field(default=None, validation_alias="LOCATION_SOURCE_NOISE_NIGHT_PATH")
    location_source_osm_primary_roads_path: str | None = Field(default=None, validation_alias="LOCATION_SOURCE_OSM_PRIMARY_ROADS_PATH")
    location_source_osm_tram_tracks_path: str | None = Field(default=None, validation_alias="LOCATION_SOURCE_OSM_TRAM_TRACKS_PATH")
    location_source_osm_railway_path: str | None = Field(default=None, validation_alias="LOCATION_SOURCE_OSM_RAILWAY_PATH")
    location_source_osm_airports_path: str | None = Field(default=None, validation_alias="LOCATION_SOURCE_OSM_AIRPORTS_PATH")

    # Optional OSRM server URL for walking-distance routing (e.g. http://localhost:5000).
    # If not set, walkability uses air distance as fallback and sets walkability_walking_fallback_used.
    osrm_url: str | None = Field(default=None, validation_alias="OSRM_URL")

    model_config = SettingsConfigDict(
        env_file=str(_PROJECT_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()

