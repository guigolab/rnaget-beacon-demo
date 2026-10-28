from fastapi import Query, Response, Request
from . import matrix_service

async def get_matrices(limit: int = Query(10), skip: int = Query(0)):
    args = {"limit": limit, "skip": skip}
    return Response(content=await matrix_service.get_matrices(args), media_type="application/json", status_code=200)

async def get_matrix(matrix_id: str):
    matrix = await matrix_service.get_matrix(matrix_id)
    return Response(content=matrix.to_json(), media_type="application/json", status_code=200)

async def get_matrix_biosamples(matrix_id: str, limit: int = Query(10), skip: int = Query(0)):
    args = {"limit": limit, "skip": skip}
    return Response(content=await matrix_service.get_related_biosamples(matrix_id, args), media_type="application/json", status_code=200)

async def get_matrix_features(matrix_id: str, limit: int = Query(10), skip: int = Query(0)):
    args = {"limit": limit, "skip": skip}
    return Response(content=await matrix_service.get_related_features(matrix_id, args), media_type="application/json", status_code=200)

async def get_expression_values(
    matrix_id: str,
    featureIDList: str = Query(None),
    biosampleIDList: str = Query(None),
    maxValue: float = Query(None),
    minValue: float = Query(None),
    skip: int = Query(0),
    limit: int = Query(10)
):
    return Response(
        content=await matrix_service.get_expression_values(
            matrix_id, 
            featureIDList=featureIDList,
            biosampleIDList=biosampleIDList,
            maxValue=maxValue,
            minValue=minValue,
            skip=skip,
            limit=limit
        ), 
        media_type="application/json", 
        status_code=200
    )

async def post_expression_values(matrix_id: str, request: Request):
    return Response(content=await matrix_service.map_post_request(matrix_id, request), media_type="application/json", status_code=200)