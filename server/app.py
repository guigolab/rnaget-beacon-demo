import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from starlette.exceptions import HTTPException as StarletteHTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse

from beacon import config as beacon_config
from beacon.fixtures import get_store
from beacon.schemas.openapi_entities import patch_openapi_schema
from routers import register_beacon_routers

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Fail fast on bad DATA_PACKAGE_PATH / package load before serving traffic.
    store = get_store()
    backend = type(store).__name__
    logger.info("Beacon store ready: %s", backend)
    yield


app = FastAPI(
    title=beacon_config.BEACON_NAME,
    description=beacon_config.BEACON_DESCRIPTION,
    version=beacon_config.API_VERSION,
    lifespan=lifespan,
)

register_beacon_routers(app)


def _default_received() -> dict:
    from beacon.responses import default_error_received

    return default_error_received()


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    from beacon.responses import build_error_response

    detail = exc.errors()[0].get("msg", "Invalid request") if exc.errors() else "Invalid request"
    return JSONResponse(
        status_code=400,
        content=build_error_response(400, str(detail), received=_default_received()),
    )


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(
    request: Request, exc: StarletteHTTPException
) -> JSONResponse:
    from beacon.responses import build_error_response

    code = exc.status_code
    message = exc.detail if isinstance(exc.detail, str) else "Request failed"
    return JSONResponse(
        status_code=code,
        content=build_error_response(code, message, received=_default_received()),
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    from beacon.responses import build_error_response

    logger.exception("Unhandled error on %s", request.url.path)
    return JSONResponse(
        status_code=500,
        content=build_error_response(
            500, "Internal server error", received=_default_received()
        ),
    )


def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema
    schema = get_openapi(
        title=app.title,
        version=app.version,
        description=app.description,
        routes=app.routes,
    )
    app.openapi_schema = patch_openapi_schema(schema)
    return app.openapi_schema


app.openapi = custom_openapi

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
