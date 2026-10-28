from fastapi import FastAPI

from . import biosamples, features, informational, matrices


def register_beacon_routers(app: FastAPI) -> None:
    app.include_router(informational.router)
    app.include_router(biosamples.router)
    app.include_router(features.router)
    app.include_router(matrices.router)
