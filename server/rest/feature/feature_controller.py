from fastapi import Query, Response
from . import feature_service

async def get_feature(sequence_id: str):
    sequence_obj = await feature_service.get_sequence(sequence_id)
    return Response(content=sequence_obj.to_json(), media_type="application/json", status_code=200)

async def get_features(limit: int = Query(10), skip: int = Query(0)):
    args = {"limit": limit, "skip": skip}
    return Response(content=await feature_service.get_sequences(args), media_type="application/json", status_code=200)

async def get_feature_matrices(sequence_id: str):
    return Response(content=await feature_service.get_related_matrices(sequence_id), media_type="application/json", status_code=200)
