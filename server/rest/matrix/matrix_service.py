from db.models import BioSample,ExpressionMatrix,SequenceFeature,ExpressionValue
from errors import NotFound
from helpers import data

def get_matrix(matrix_id):
    matrix = ExpressionMatrix.objects(matrix_id=matrix_id).first()
    if not matrix:
        raise NotFound
    return matrix

def get_matrices(args):
    items = ExpressionMatrix.objects()
    total = items.count()
    limit, skip = data.get_pagination(args)     
    response = dict(total=total, data=list(items.skip(skip).limit(limit).as_pymongo()))
    return data.dump_json(response)

def get_related_biosamples(matrix_id):
    ##check if the matrix exists
    get_matrix(matrix_id)

    biosamples = BioSample.objects(matrices=matrix_id).as_pymongo()
    return data.dump_json(list(biosamples))


def get_related_features(matrix_id):
    ##check if the matrix exists
    get_matrix(matrix_id)

    features = SequenceFeature.objects(matrices=matrix_id).as_pymongo()
    return data.dump_json(list(features))


def get_expression_values(matrix_id,featureIDList=None,biosampleIDList=None,maxValue=None,minValue=None,skip=0,limit=10):
    
    ##check if the matrix exists
    get_matrix(matrix_id)

    query=dict(matrix_id=matrix_id)
    if featureIDList:
        query["feature_id__in"] = featureIDList
    if biosampleIDList:
        query["biosample_id__in"] = biosampleIDList
    if minValue:
        query["value__gte"] = minValue
    if maxValue:
        query["value__lte"] = maxValue

    expression_values = ExpressionValue.objects(**query)

    total = expression_values.count()
    response = dict(total=total, data=list(expression_values.skip(skip).limit(limit).as_pymongo()))
    return data.dump_json(response)