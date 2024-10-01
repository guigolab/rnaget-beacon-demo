from db.models import SequenceFeature,ExpressionMatrix
from werkzeug.exceptions import NotFound
from helpers import data as data_helper

def get_sequence(sequence_id):
    sequence = SequenceFeature.objects(sequence_id=sequence_id).exclude('id').first()
    if not sequence:
        raise NotFound(description=f"Feature with id {sequence_id} not found")
    return sequence

def get_sequences(args):
    items = SequenceFeature.objects().exclude('id')
    total = items.count()
    limit, skip = data_helper.get_pagination(args)     
    response = dict(total=total, data=list(items.skip(skip).limit(limit).as_pymongo()))
    return data_helper.dump_json(response)

def get_related_matrices(sequence_id):
    sequence = get_sequence(sequence_id)
    matrices = ExpressionMatrix.objects(expression_matrix_id__in=sequence.matrices).exclude('id').as_pymongo()
    return data_helper.dump_json(list(matrices))