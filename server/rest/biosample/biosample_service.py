from db.models import BioSample,ExpressionMatrix
from errors import NotFound
from helpers import data

def get_biosample(sample_id):
    biosample = BioSample.objects(sample_id=sample_id).first()
    if not biosample:
        raise NotFound
    return biosample

def get_biosamples(args):
    items = BioSample.objects()
    total = items.count()
    limit, skip = data.get_pagination(args)     
    response = dict(total=total, data=list(items.skip(skip).limit(limit).as_pymongo()))
    return data.dump_json(response)

def get_related_matrices(sample_id):
    biosample = get_biosample(sample_id)
    matrices = ExpressionMatrix.objects(expression_matrix_id__in=biosample.matrices).as_pymongo()
    return data.dump_json(list(matrices))