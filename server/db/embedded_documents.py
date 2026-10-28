from . import db

class OntologyTerm(db.EmbeddedDocument):
    id = db.StringField()
    label = db.StringField()

class Assembly(db.EmbeddedDocument):
    accession = db.StringField()
    name = db.StringField()

class Protocol(db.EmbeddedDocument):
    id = db.StringField()
    label = db.StringField()
    description = db.StringField()

class AnnotationSource(db.EmbeddedDocument):
    name = db.StringField()
    version = db.StringField()

class Number(db.EmbeddedDocument):
    type = db.StringField(default="Number")
    value = db.IntField()

class Interval(db.EmbeddedDocument):
    end = db.EmbeddedDocumentField(Number)
    start = db.EmbeddedDocumentField(Number)
    type = db.StringField(default="SequenceInterval")

class Location(db.EmbeddedDocument):
    sequence_id = db.StringField(required=True)
    type = db.StringField(default="SequenceLocation")
    interval = db.EmbeddedDocumentField(Interval)

