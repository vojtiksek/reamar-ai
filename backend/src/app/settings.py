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

    frontend_url: str = Field(default="http://localhost:3001", validation_alias="FRONTEND_URL")

    # Comma-separated list of allowed CORS origins.
    # In production set to your Vercel URL, e.g. "https://reamar-ai.vercel.app"
    allowed_origins: str = Field(
        default=(
            "http://localhost:3000,http://127.0.0.1:3000,"
            "http://localhost:3001,http://127.0.0.1:3001,"
            "http://localhost:3002,http://127.0.0.1:3002,"
            "http://192.168.0.96:3002,http://192.168.1.204:3001,"
            "http://100.118.81.100:3000,http://100.118.81.100:3001,http://100.118.81.100:3002"
        ),
        validation_alias="ALLOWED_ORIGINS",
    )

    @property
    def allowed_origins_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    builtmind_api_key: str | None = Field(default=None, validation_alias="BUILTMIND_API_KEY")

    # ----- Supabase (Auth) -----
    # Project URL — required for admin broker operations (Supabase Admin API).
    supabase_url: str | None = Field(default=None, validation_alias="SUPABASE_URL")
    # JWKS discovery URL — public endpoint with signing keys for asymmetric JWT verification.
    # Typical form: https://<project>.supabase.co/auth/v1/.well-known/jwks.json
    supabase_jwks_url: str | None = Field(default=None, validation_alias="SUPABASE_JWKS_URL")
    # Legacy HS256 secret — kept for backward compatibility with old tokens.
    # New projects use asymmetric keys (JWKS). If both are set, JWKS is preferred.
    supabase_jwt_secret: str | None = Field(default=None, validation_alias="SUPABASE_JWT_SECRET")
    # Service-role key — server-only secret. Bypasses RLS.
    # Needed by /admin/brokers to invite/delete users in Supabase Auth.
    supabase_service_role_key: str | None = Field(default=None, validation_alias="SUPABASE_SERVICE_ROLE_KEY")

    model_config = SettingsConfigDict(
        env_file=str(_PROJECT_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()

