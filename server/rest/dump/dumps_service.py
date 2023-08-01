from db.models import GenomeAnnotation, Assembly, Organism, TaxonNode
import json

MODEL = {
    'organism': Organism,
    'assembly': Assembly,
    'annotation': GenomeAnnotation,
    'taxon': TaxonNode
}

def get_data(model):
    if not model in MODEL.keys():
        return json.dumps(f"{model} not found"), 404
    return MODEL[model].objects().to_json(), 200
    
