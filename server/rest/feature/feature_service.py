from db.models import SequenceFeature,ExpressionMatrix
from errors import NotFound
from helpers import data

def get_sequence(sequence_id):
    sequence = SequenceFeature.objects(sequence_id=sequence_id).first()
    if not sequence:
        raise NotFound
    return sequence

def get_sequences(args):
    items = SequenceFeature.objects()
    total = items.count()
    limit, skip = data.get_pagination(args)     
    response = dict(total=total, data=list(items.skip(skip).limit(limit).as_pymongo()))
    return data.dump_json(response)

def get_related_matrices(sequence_id):
    sequence = get_sequence(sequence_id)
    matrices = ExpressionMatrix.objects(expression_matrix_id__in=sequence.matrices).as_pymongo()
    return data.dump_json(list(matrices))