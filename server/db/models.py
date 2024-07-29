from . import db,enums

class BioSample(db.Document):
    biosample_id = db.StringField(required=True,unique=True)
    matrices = db.ListField(db.StringField())
    metadata= db.DictField()

class ExpressionValue(db.Document):
    expression_id = db.StringField(required=True,unique=True)
    sequence_id = db.StringField(required=True)
    biosample_id = db.StringField(required=True)
    value = db.FloatField(required=True)

class SequenceFeature(db.Document):
    sequence_id = db.StringField(required=True, unique= True)
    biological_functions=db.ListField()
    molecular_type=db.StringField()
    matrices=db.ListField(db.StringField())
    metadata=db.DictField()

class ExpressionMatrix(db.Document):
    expression_id = db.StringField(required=True, unique=True)
    name=db.StringField(required=True)
    description=db.StringField()
    tax_id=db.StringField()
    downloadLink=db.URLField()
    unit = db.EnumField(enums.Units)
    reference_annotation = db.StringField(required=True)
    rows=db.IntField()
    columns=db.IntField()
