from . import db, enums

EXPRESSION_VALUE_FIELDS=['biosampleID','featureID','value']

class OntologyTerm(db.EmbeddedDocument):
    id = db.StringField()
    label = db.StringField()

class BioSample(db.DynamicDocument):
    biosampleID = db.StringField(unique=True, required=True)
    matrices = db.ListField(db.StringField())
    meta = {
        'indexes': ['biosampleID']
    }

class ExpressionValue(db.Document):
    featureID = db.StringField(required=True)
    biosampleID = db.StringField(required=True)
    matrixID = db.StringField(required=True)
    value = db.FloatField(required=True)
    meta = {
        'indexes': [
            'matrixID',
            'biosampleID',
            'featureID',
            'value',
            {
                'fields': ['featureID', 'biosampleID','matrixID'],
                'unique': True  
            }
        ],
        'strict': False
    }

class SequenceFeature(db.DynamicDocument):
    featureID = db.StringField(unique=True, required=True)
    name= db.StringField()
    biologicalFunctions=db.ListField(db.EmbeddedDocumentField(OntologyTerm))
    molecularType=db.EmbeddedDocumentField(OntologyTerm)
    matrices=db.ListField(db.StringField())
    meta = {
        'indexes': ['featureID','molecularType']
    }

class ExpressionMatrix(db.DynamicDocument):
    matrixID = db.StringField(unique=True, required=True)
    name=db.StringField(required=True)
    description=db.StringField()
    taxID=db.StringField()
    downloadLink=db.URLField()
    unit = db.EnumField(enums.Units, required=True)
    referenceAnnotation = db.StringField(required=True)
    featuresCount=db.IntField()
    biosamplesCount=db.IntField()
    meta = {
        'indexes': ['matrixID','name','taxID']
    }



