from . import db, enums
from mongoengine.queryset import queryset_manager

EXPRESSION_VALUE_FIELDS=['biosampleID','sequenceID','value']

class OntologyTerm(db.EmbeddedDocument):
    id = db.StringField() #CURIE
    label = db.StringField()

class BioSample(db.DynamicDocument):
    biosampleID = db.StringField(unique=True, required=True)
    matrices = db.ListField(db.StringField())
    meta = {
        'indexes': ['biosampleID']
    }
    @queryset_manager
    def objects(doc_cls, queryset):
        return queryset.exclude('id')

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
    @queryset_manager
    def objects(doc_cls, queryset):
        return queryset.only(*EXPRESSION_VALUE_FIELDS).exclude('id')

class SequenceFeature(db.DynamicDocument):
    sequenceID = db.StringField(unique=True, required=True)
    name= db.StringField()
    biologicalFunctions=db.ListField(db.EmbeddedDocumentField(OntologyTerm))
    molecularType=db.EmbeddedDocumentField(OntologyTerm)
    matrices=db.ListField(db.StringField())
    meta = {
        'indexes': ['sequenceID','molecularType']
    }
    @queryset_manager
    def objects(doc_cls, queryset):
        return queryset.exclude('id')

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
    @queryset_manager
    def objects(doc_cls, queryset):
        return queryset.exclude('id')


