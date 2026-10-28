# Legacy REST package: only /api/uploads/* is registered when ENABLE_LEGACY_UPLOADS=1.
# biosample/feature/matrix controllers under rest/ are unused (pre-Beacon, broken SequenceFeature imports).
from fastapi import APIRouter
from .routes import initialize_routes
import logging

logger = logging.getLogger(__name__)

api_router = APIRouter()

def initialize_api(app):
	logger.info("Initializing REST Apis")
	initialize_routes(api_router)
	app.include_router(api_router)