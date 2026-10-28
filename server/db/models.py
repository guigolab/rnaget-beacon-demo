from . import db, enums
from .embedded_documents import (
    OntologyTerm,
    Assembly,
    Protocol,
    Location
)

EXPRESSION_VALUE_FIELDS=['biosampleID','featureID','value']

class BioSample(db.DynamicDocument):
    biosampleId = db.StringField(unique=True, required=True)
    matrixIds = db.ListField(db.StringField())
    meta = {
        'indexes': ['biosampleId', 'matrixIds'],
    }

class ExpressionValue(db.Document):
    featureId = db.StringField(required=True)
    biosampleId = db.StringField(required=True)
    matrixId = db.StringField(required=True)
    value = db.FloatField(required=True)
    meta = {
        'indexes': [
            'matrixId',
            'biosampleId',
            'featureId',
            'value',
        ],
    }

class GenomicFeature(db.DynamicDocument):
    # Required fields
    featureId = db.StringField(unique=True, required=True)
    
    # Optional fields
    location = db.EmbeddedDocumentField(Location)  # SequenceLocation with exact coordinates 
    aliases = db.ListField(db.StringField())
    ontologyTerms = db.ListField(db.EmbeddedDocumentField(OntologyTerm))
    xrefs = db.ListField(db.StringField()) # list of external identifiers
    parent = db.StringField() # parent feature id in case of exon or transcript
    children = db.ListField(db.StringField()) # list of child feature ids in case of genes or transcripts (transcripts or exons)
    matrixIds = db.ListField(db.StringField()) # all the matrices have the same annotation source
    meta = {
        'indexes': ['featureId', 'parent', 'children', 'xrefs', 'matrixIds', 'aliases', 'ontologyTerms'],
        'strict': False  # Allow additional properties as per schema
    }


class Matrix(db.DynamicDocument):
    # Required fields
    matrixId = db.StringField(required=True)
    annotationUrl = db.StringField(required=True) # URL to download the annotation file can be a local file or a remote file
    downloadUrl = db.StringField(required=True) # URL to download the matrix file can be a local file or a remote file
    assembly = db.EmbeddedDocumentField(Assembly, required=True)
    unit = db.EnumField(enums.Units, required=True)
    
    # Optional fields
    createDateTime = db.DateTimeField() # date and time of the creation of the matrix
    description = db.StringField() #here we expect whether is bulk or single cell data, maybe the type should be an additional field
    name = db.StringField() #name of the matrix or the experiment 
    featuresCount = db.IntField()
    biosamplesCount = db.IntField()
    protocols = db.ListField(db.EmbeddedDocumentField(Protocol)) #ordered list of steps to create the RNA-seq data
    info = db.DictField()  # Flexible dict field for additional info
    
    meta = {
        'indexes': ['matrixId', 'unit', 'protocols.id', 'assembly.accession', 'assembly.name'],
        'strict': False  # Allow additional properties as per schema
    }
