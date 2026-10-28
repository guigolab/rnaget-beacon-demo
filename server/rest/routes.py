from fastapi import APIRouter

from .upload import uploads_controller


def initialize_routes(router: APIRouter):
    """Legacy non-Beacon upload routes (kept for ingest workflows)."""
    router.add_api_route("/api/uploads/tsv", uploads_controller.upload_tsv, methods=["POST"])
    router.add_api_route(
        "/api/uploads/matrix_market",
        uploads_controller.upload_matrix_market,
        methods=["POST"],
    )
    router.add_api_route(
        "/api/uploads/matrix_market/{task_id}",
        uploads_controller.check_job_status,
        methods=["GET"],
    )
    router.add_api_route(
        "/api/uploads/tsv/{task_id}",
        uploads_controller.check_job_status,
        methods=["GET"],
    )
