import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from beacon import config as beacon_config
from routers import register_beacon_routers

logger = logging.getLogger(__name__)

app = FastAPI(
    title=beacon_config.BEACON_NAME,
    description=beacon_config.BEACON_DESCRIPTION,
    version=beacon_config.API_VERSION,
)

register_beacon_routers(app)

# Optional legacy upload API (Mongo + Celery). Off by default for fixture-backed demo.
if beacon_config.ENABLE_LEGACY_UPLOADS:
    try:
        from config import BaseConfig
        from db import initialize_db
        from jobs import celery_init_app
        from rest import initialize_api

        app.state.config = BaseConfig
        initialize_db(BaseConfig)
        celery_config = dict(
            broker_url=BaseConfig.CELERY_BROKER_URL,
            result_backend=BaseConfig.CELERY_RESULT_BACKEND,
            task_ignore_result=True,
        )
        celery_init_app(celery_config)
        initialize_api(app)
        logger.info("Legacy upload API enabled under /api/uploads/*")
    except Exception:
        logger.exception("Failed to enable legacy uploads; continuing without them")

_cors_origins = [
    o.strip() for o in os.environ.get("CORS_ALLOW_ORIGINS", "*").split(",") if o.strip()
]
# Browsers reject Access-Control-Allow-Origin: * together with credentials.
_cors_credentials = os.environ.get("CORS_ALLOW_CREDENTIALS", "0").lower() in (
    "1",
    "true",
    "yes",
)
if _cors_origins == ["*"]:
    _cors_credentials = False

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=_cors_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)
