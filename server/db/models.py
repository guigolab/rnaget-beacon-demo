from . import db, enums

class OntologyTerm(db.EmbeddedDocument):
    id = db.StringField() #CURIE
    label = db.StringField()

class BioSample(db.Document):
    id = db.StringField(primary_key=True)
    matrices = db.ListField(db.StringField())
    meta = {
        'indexes': ['id']
    }

class ExpressionValue(db.Document):
    sequenceID = db.StringField(required=True)
    biosampleID = db.StringField(required=True)
    matrixID = db.StringField(required=True)
    value = db.FloatField(required=True)
    meta = {
        'indexes': [
            {
                'fields': ['sequenceID', 'biosampleID','matrixID'],
                'unique': True  # This enforces uniqueness
            }
        ],
        'strict': False
    }

class SequenceFeature(db.Document):
    id = db.StringField(primary_key=True)
    biologicalFunctions=db.ListField(db.EmbeddedDocumentField(OntologyTerm))
    molecularType=db.EmbeddedDocumentField(OntologyTerm)
    matrices=db.ListField(db.StringField())
    meta = {
        'indexes': ['id','molecularType']
    }

class ExpressionMatrix(db.Document):
    id = db.StringField(primary_key=True)
    name=db.StringField(required=True)
    description=db.StringField()
    taxID=db.StringField()
    downloadLink=db.URLField()
    unit = db.EnumField(enums.Units)
    referenceAnnotation = db.StringField(required=True)
    featuresCount=db.IntField()
    biosamplesCount=db.IntField()
    meta = {
        'indexes': ['id','name','taxID']
    }


