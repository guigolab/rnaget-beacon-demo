from db.models import SequenceFeature,Matrix
from fastapi import HTTPException
from helpers import data as data_helper

async def get_sequence(sequence_id):
    sequence = SequenceFeature.objects(featureID=sequence_id).exclude('id').first()
    if not sequence:
        raise HTTPException(status_code=404, detail=f"Feature with id {sequence_id} not found")
    return sequence

async def get_sequences(args):
    items = SequenceFeature.objects().exclude('id')
    total = items.count()
    limit, skip = data_helper.get_pagination(args)     
    response = dict(total=total, data=list(items.skip(skip).limit(limit).as_pymongo()))
    return data_helper.dump_json(response)

async def get_related_matrices(sequence_id):
    sequence = await get_sequence(sequence_id)
    matrices = Matrix.objects(matrixId__in=sequence.matrices).as_pymongo()
    return data_helper.dump_json(list(matrices))