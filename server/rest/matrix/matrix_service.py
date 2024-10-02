from db.models import BioSample,ExpressionMatrix,SequenceFeature,ExpressionValue
from helpers import data as data_helper
from werkzeug.exceptions import NotFound

EXPRESSION_VALUE_FIELDS=['biosampleID','featureID','value']

def get_matrix(matrix_id):
    matrix = ExpressionMatrix.objects(matrixID=matrix_id).exclude('id').first()
    if not matrix:
        raise NotFound(description=f"Matrix with id {matrix_id} not found")
    
    return matrix

def get_matrices(args):
    items = ExpressionMatrix.objects().exclude('id')

    total = items.count()

    limit, skip = data_helper.get_pagination(args)     

    response = dict(total=total, data=list(items.skip(skip).limit(limit).as_pymongo()))

    return data_helper.dump_json(response)

def get_related_biosamples(matrix_id, args):

    get_matrix(matrix_id)

    limit, skip = data_helper.get_pagination(args)     

    biosamples = BioSample.objects(matrices=matrix_id).exclude('id')

    total = biosamples.count()

    response = dict(total=total, data=list(biosamples.skip(skip).limit(limit).as_pymongo()))

    return data_helper.dump_json(response)


def get_related_features(matrix_id, args):

    get_matrix(matrix_id)

    limit, skip = data_helper.get_pagination(args)     

    features = SequenceFeature.objects(matrices=matrix_id).exclude('id')

    total = features.count()

    response = dict(total=total, data=list(features.skip(skip).limit(limit).as_pymongo()))

    return data_helper.dump_json(response)


def map_post_request(matrix_id, request):

    data = request.json if request.is_json else request.form
    
    payload_fields = ['featureIDList','biosampleIDList','maxValue','minValue']
    
    data_helper.validate_fields(payload_fields, data)

    payload = {f:data[f] for f in data}

    return get_expression_values(matrix_id, **payload)

def get_expression_values(matrix_id,featureIDList=None,biosampleIDList=None,maxValue=None,minValue=None,skip=0,limit=10):
    
    get_matrix(matrix_id)

    query=dict(matrixID=matrix_id)

    if featureIDList:
        query["featureID__in"] = featureIDList.split(',')

    if biosampleIDList:
        query["biosampleID__in"] = biosampleIDList.split(',')

    if minValue:
        query["value__gte"] = minValue

    if maxValue:
        query["value__lte"] = maxValue

    expression_values = ExpressionValue.objects(**query).only(*EXPRESSION_VALUE_FIELDS).exclude('id').skip(skip).limit(limit)

    total = expression_values.count()

    response = dict(total=total, data=list(expression_values.as_pymongo()))

    return data_helper.dump_json(response)