from db.models import BioSample,Matrix
from fastapi import HTTPException
from helpers import data as data_helper

async def get_biosample(sample_id):
    biosample = BioSample.objects(biosampleID=sample_id).first()
    if not biosample:
        raise HTTPException(status_code=404, detail=f"biosample with id {sample_id} not found")
    return biosample

async def get_biosamples(args):
    items = BioSample.objects().exclude('id')
    total = items.count()
    limit, skip = data_helper.get_pagination(args)     
    response = dict(total=total, data=list(items.skip(skip).limit(limit).as_pymongo()))
    return data_helper.dump_json(response)

async def get_related_matrices(sample_id):
    biosample = await get_biosample(sample_id)
    matrices = Matrix.objects(matrixId__in=biosample.matrices).as_pymongo()
    return data_helper.dump_json(list(matrices))