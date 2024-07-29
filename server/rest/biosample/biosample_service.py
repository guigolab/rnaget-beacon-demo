from db.models import BioSample
from errors import NotFound

def get_biosample(sample_id):
    biosample = BioSample.objects(sample_id=sample_id).first()
    if not biosample:
        raise NotFound
    return biosample


def get_biosamples(args):
