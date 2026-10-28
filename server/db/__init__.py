from mongoengine import connect
from mongoengine import Document, EmbeddedDocument, StringField, ListField, FloatField, IntField, EnumField, URLField, DynamicDocument, EmbeddedDocumentField, DateTimeField, DictField
import logging

logger = logging.getLogger(__name__)

# Create a db object for model imports
class _DB:
    pass

db = _DB()
db.Document = Document
db.EmbeddedDocument = EmbeddedDocument
db.StringField = StringField
db.ListField = ListField
db.FloatField = FloatField
db.IntField = IntField
db.EnumField = EnumField
db.URLField = URLField
db.DynamicDocument = DynamicDocument
db.EmbeddedDocumentField = EmbeddedDocumentField
db.DateTimeField = DateTimeField
db.DictField = DictField

def initialize_db(config):
	logger.info("Initializing MongoDB")
	connect(
		db=config.MONGODB_DB,
		host=config.MONGODB_HOST,
		port=config.MONGODB_PORT,
		username=config.MONGODB_USERNAME,
		password=config.MONGODB_PASSWORD,
	)
	