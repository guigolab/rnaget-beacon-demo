from db.models import BioSample,Matrix,SequenceFeature,ExpressionValue
from helpers import data as data_helper
from fastapi import HTTPException

EXPRESSION_VALUE_FIELDS=['biosampleID','featureID','value']

async def get_matrix(matrix_id):
    matrix = Matrix.objects(matrixId=matrix_id).first()
    if not matrix:
        raise HTTPException(status_code=404, detail=f"Matrix with id {matrix_id} not found")
    
    return matrix

async def get_matrices(args):
    items = Matrix.objects()

    total = items.count()

    limit, skip = data_helper.get_pagination(args)     

    response = dict(total=total, data=list(items.skip(skip).limit(limit).as_pymongo()))

    return data_helper.dump_json(response)

async def get_related_biosamples(matrix_id, args):

    await get_matrix(matrix_id)

    limit, skip = data_helper.get_pagination(args)     

    biosamples = BioSample.objects(matrices=matrix_id).exclude('id')

    total = biosamples.count()

    response = dict(total=total, data=list(biosamples.skip(skip).limit(limit).as_pymongo()))

    return data_helper.dump_json(response)


async def get_related_features(matrix_id, args):

    await get_matrix(matrix_id)

    limit, skip = data_helper.get_pagination(args)     

    features = SequenceFeature.objects(matrices=matrix_id).exclude('id')

    total = features.count()

    response = dict(total=total, data=list(features.skip(skip).limit(limit).as_pymongo()))

    return data_helper.dump_json(response)


async def map_post_request(matrix_id, request):

    try:
        data = await request.json()
    except:
        form = await request.form()
        data = dict(form)
    
    payload_fields = ['featureIDList','biosampleIDList','maxValue','minValue']
    
    data_helper.validate_fields(payload_fields, data)

    payload = {f:data[f] for f in data}

    return await get_expression_values(matrix_id, **payload)

async def get_expression_values(matrix_id,featureIDList=None,biosampleIDList=None,maxValue=None,minValue=None, skip=0, limit=10):
    
    await get_matrix(matrix_id)

    query=dict(matrixID=matrix_id)

    if featureIDList:
        query["featureID__in"] = featureIDList.split(',')

    if biosampleIDList:
        query["biosampleID__in"] = biosampleIDList.split(',')

    if minValue:
        query["value__gte"] = minValue

    if maxValue:
        query["value__lte"] = maxValue

    limit = int(limit)

    skip = int(skip)
    
    expression_values = ExpressionValue.objects(**query).only(*EXPRESSION_VALUE_FIELDS).exclude('id').skip(skip).limit(limit)

    total = expression_values.count()

    response = dict(total=total, data=list(expression_values.as_pymongo()))

    return data_helper.dump_json(response)