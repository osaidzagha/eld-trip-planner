"""
Django settings for config project.

Environment variables (all optional except SECRET_KEY in production):
  SECRET_KEY           Django secret key. REQUIRED when DEBUG is not "1".
  DEBUG                Set to "1" to enable debug mode. Default: off (False).
  ALLOWED_HOSTS        Comma-separated list. Default: ".onrender.com,localhost,127.0.0.1"
  CORS_ALLOWED_ORIGINS Comma-separated origins (trailing slashes stripped).
                       When set, CORS_ALLOW_ALL_ORIGINS is disabled.
  CSRF_TRUSTED_ORIGINS Same format as CORS_ALLOWED_ORIGINS.
  ORS_API_KEY          Optional OpenRouteService key (falls back to public OSRM).
"""

from pathlib import Path
import os
import sys

BASE_DIR = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------------------
# Security
# ---------------------------------------------------------------------------
DEBUG = os.environ.get("DEBUG", "").strip() == "1"

_secret_key_env = os.environ.get("SECRET_KEY", "").strip()
_is_testing = (
    "pytest" in sys.modules
    or "test" in sys.argv
    or any("pytest" in arg for arg in sys.argv)
    or "PYTEST_CURRENT_TEST" in os.environ
)
_is_dev_command = any(
    cmd in sys.argv
    for cmd in ["runserver", "shell", "makemigrations", "migrate", "collectstatic"]
)
if not _secret_key_env:
    if DEBUG or _is_testing or _is_dev_command:
        # Development / test fallback — never used in production
        _secret_key_env = "django-insecure-dev-only-0yoma=w=5(x)e@@%zh=l#4ti"
    else:
        # Hard failure: do NOT start with a missing secret in production
        print(
            "FATAL: SECRET_KEY environment variable is not set. "
            "Set it to a long random string before starting in production.",
            file=sys.stderr,
        )
        sys.exit(1)

SECRET_KEY = _secret_key_env

_allowed_hosts_env = os.environ.get(
    "ALLOWED_HOSTS", ".onrender.com,localhost,127.0.0.1"
)
ALLOWED_HOSTS = [h.strip() for h in _allowed_hosts_env.split(",") if h.strip()]

# ---------------------------------------------------------------------------
# Application definition
# ---------------------------------------------------------------------------
INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Third party
    "corsheaders",
    "rest_framework",
    # Local
    "planner",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",  # must be after SecurityMiddleware
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
    }
}

AUTH_PASSWORD_VALIDATORS = []

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_STORAGE = "whitenoise.storage.CompressedManifestStaticFilesStorage"

# ---------------------------------------------------------------------------
# Cache — in-memory (swap for Redis via CACHE_URL in production if needed)
# ---------------------------------------------------------------------------
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "eld-trip-planner-cache",
    }
}

# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------
def _parse_origins(env_val: str) -> list[str]:
    """Split comma-separated origins, strip whitespace and trailing slashes."""
    return [o.strip().rstrip("/") for o in env_val.split(",") if o.strip()]


_cors_origins_env = os.environ.get("CORS_ALLOWED_ORIGINS", "").strip()
if _cors_origins_env:
    CORS_ALLOWED_ORIGINS = _parse_origins(_cors_origins_env)
    CORS_ALLOW_ALL_ORIGINS = False
else:
    # Open in dev; lock down via env var in production
    CORS_ALLOW_ALL_ORIGINS = DEBUG

# ---------------------------------------------------------------------------
# CSRF trusted origins (required when behind Render's HTTPS proxy)
# ---------------------------------------------------------------------------
_csrf_origins_env = os.environ.get("CSRF_TRUSTED_ORIGINS", "").strip()
if _csrf_origins_env:
    CSRF_TRUSTED_ORIGINS = _parse_origins(_csrf_origins_env)

# ---------------------------------------------------------------------------
# Production proxy SSL header (Render terminates TLS upstream)
# ---------------------------------------------------------------------------
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# ---------------------------------------------------------------------------
# DRF
# ---------------------------------------------------------------------------
REST_FRAMEWORK = {
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
    ],
}
