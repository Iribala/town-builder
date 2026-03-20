"""Configuration management for Town Builder application."""

from pathlib import Path

from pydantic import ConfigDict, Field
from pydantic_settings import BaseSettings
import dotenv

# Load environment variables
dotenv.load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    """Application settings.

    Field defaults are used as fallbacks. Pydantic Settings automatically reads
    matching environment variables (case-insensitive). For fields whose env var
    name differs from the field name, use ``validation_alias``.
    """

    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    # Server settings
    app_title: str = "Town Builder API"
    app_description: str = (
        "Interactive 3D town building application with real-time collaboration"
    )
    app_version: str = "1.0.0"
    environment: str = "development"

    # JWT Authentication
    jwt_secret_key: str = ""
    jwt_algorithm: str = "HS256"
    disable_jwt_auth: bool = False

    # External API (Django)
    api_url: str = Field(
        default="http://localhost:8000/api/towns/",
        validation_alias="TOWN_API_URL",
    )
    api_token: str | None = Field(
        default=None,
        validation_alias="TOWN_API_JWT_TOKEN",
    )

    # Redis
    redis_url: str = "redis://localhost:6379/0"
    pubsub_channel: str = "town_events"

    # Paths
    models_path: str = str(BASE_DIR / "static" / "models")
    static_path: str = str(BASE_DIR / "static")
    templates_path: str = str(BASE_DIR / "templates")
    data_path: str = str(BASE_DIR / "data")

    # Root path for reverse proxy deployments (e.g., /town-builder)
    root_path: str = ""

    # Timeouts and intervals (seconds)
    sse_timeout: float = 10.0
    sse_keepalive_interval: float = 10.0
    user_activity_timeout: float = 30.0

    # History and snapshot limits
    max_history_size: int = 100
    max_snapshots: int = 50

    # Request limits
    max_request_body_bytes: int = 10 * 1024 * 1024  # 10 MB default
    max_batch_operations: int = 100
    max_sse_connections_per_user: int = 3

    # Allowed origins for CORS (comma-separated).
    # Defaults to empty; main.py adds localhost origins automatically in development.
    # Always set ALLOWED_ORIGINS explicitly in production.
    allowed_origins: str = ""

    # Allowed API domains (comma-separated) for SSRF prevention
    allowed_domains: str = "localhost,127.0.0.1"

    # Parsed list of allowed API domains (computed from allowed_domains in __init__)
    allowed_api_domains: list[str] = Field(default_factory=list, exclude=True)

    def __init__(self, **kwargs):
        super().__init__(**kwargs)

        # Parse allowed_api_domains from the comma-separated allowed_domains field
        self.allowed_api_domains = [
            domain.strip() for domain in self.allowed_domains.split(",")
        ]

        # Fail fast if JWT_SECRET_KEY is not set and JWT auth is enabled
        if not self.disable_jwt_auth and not self.jwt_secret_key:
            raise ValueError(
                "JWT_SECRET_KEY environment variable must be set when JWT authentication is enabled. "
                "Set JWT_SECRET_KEY to a secure random string or set DISABLE_JWT_AUTH=true for development."
            )


# Global settings instance
settings = Settings()
