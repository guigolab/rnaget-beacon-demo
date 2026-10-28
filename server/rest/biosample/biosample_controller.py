from fastapi import Query, Response
from . import biosample_service

async def get_biosample(sample_id: str):
    biosample_obj = await biosample_service.get_biosample(sample_id)
    return Response(content=biosample_obj.to_json(), media_type="application/json", status_code=200)

async def get_biosamples(limit: int = Query(10), skip: int = Query(0)):
    args = {"limit": limit, "skip": skip}
    return Response(content=await biosample_service.get_biosamples(args), media_type="application/json", status_code=200)

async def get_biosample_matrices(sample_id: str):
    return Response(content=await biosample_service.get_related_matrices(sample_id), media_type="application/json", status_code=200)
