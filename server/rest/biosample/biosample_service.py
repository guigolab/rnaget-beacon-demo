from db.models import BioSample,ExpressionMatrix
from werkzeug.exceptions import NotFound
from helpers import data as data_helper

def get_biosample(sample_id):
    biosample = BioSample.objects(sample_id=sample_id).first()
    if not biosample:
        raise NotFound(description=f"biosample with id {sample_id} not found")
    return biosample

def get_biosamples(args):
    items = BioSample.objects().exclude('id')
    total = items.count()
    limit, skip = data_helper.get_pagination(args)     
    response = dict(total=total, data=list(items.skip(skip).limit(limit).as_pymongo()))
    return data_helper.dump_json(response)

def get_related_matrices(sample_id):
    biosample = get_biosample(sample_id)
    matrices = ExpressionMatrix.objects(expression_matrix_id__in=biosample.matrices).exclude('id').as_pymongo()
    return data_helper.dump_json(list(matrices))