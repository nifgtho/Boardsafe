from functools import lru_cache
from typing import Literal
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="BOARDSAFE_", env_file=".env", extra="ignore")
    environment: Literal["development", "test", "production"] = "development"
    database_url: str = "sqlite:///./boardsafe.db"
    jwt_secret: str = "dev-only-insecure-key-do-not-use-in-production"
    access_token_minutes: int = 60
    cors_origins: str = "http://localhost:3000"
    osrm_base_url: str = ""
    routing_timeout_seconds: float = 8.0
    public_osrm_allowed: bool = False
    bay_staleness_seconds: int = 180
    vehicle_staleness_seconds: int = 180
    route_validity_minutes: int = 60
    event_poll_seconds: int = 2
    ingest_token: str = ""
    open_meteo_enabled: bool = False

    @model_validator(mode="after")
    def check_production(self):
        if self.environment == "production":
            if len(self.jwt_secret) < 32 or "REPLACE" in self.jwt_secret or "dev-only" in self.jwt_secret:
                raise ValueError("Set a strong BOARDSAFE_JWT_SECRET in production")
            if not self.database_url.startswith("postgresql+"):
                raise ValueError("Production requires PostgreSQL")
            if not self.osrm_base_url:
                raise ValueError("Production requires a configured routing service")
            if not self.ingest_token or len(self.ingest_token) < 24 or "REPLACE" in self.ingest_token:
                raise ValueError("Set a separate ingest token")
        return self

    @property
    def allowed_origins(self):
        return [x.strip() for x in self.cors_origins.split(",") if x.strip()]

@lru_cache
def get_settings() -> Settings:
    return Settings()
