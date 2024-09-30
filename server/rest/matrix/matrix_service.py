from db.models import BioSample,ExpressionMatrix,SequenceFeature,ExpressionValue
from errors import NotFound
from helpers import data

EXPRESSION_VALUE_FIELDS=['biosampleID','featureID','value']

def get_matrix(matrix_id):
    matrix = ExpressionMatrix.objects(matrixID=matrix_id).exclude('id').first()
    if not matrix:
        raise NotFound
    
    return matrix

def get_matrices(args):
    items = ExpressionMatrix.objects().exclude('id')

    total = items.count()

    limit, skip = data.get_pagination(args)     

    response = dict(total=total, data=list(items.skip(skip).limit(limit).as_pymongo()))

    return data.dump_json(response)

def get_related_biosamples(matrix_id):

    get_matrix(matrix_id)

    biosamples = BioSample.objects(matrices=matrix_id).exclude('id').as_pymongo()

    return data.dump_json(list(biosamples))


def get_related_features(matrix_id):

    get_matrix(matrix_id)

    features = SequenceFeature.objects(matrices=matrix_id).exclude('id').as_pymongo()

    return data.dump_json(list(features))

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

    expression_values = ExpressionValue.objects(**query).only(*EXPRESSION_VALUE_FIELDS).exclude('id')

    total = expression_values.count()

    response = dict(total=total, data=list(expression_values.skip(skip).limit(limit).as_pymongo()))

    return data.dump_json(response)