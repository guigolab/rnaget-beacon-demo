from flask import Flask
from config import BaseConfig
from db import initialize_db
from rest import initialize_api
from jobs import celery_init_app
from db.models import ExpressionMatrix, ExpressionValue, BioSample, SequenceFeature
app = Flask(__name__)

app.config.from_object(BaseConfig)

app.config.from_mapping(
    CELERY=dict(
        broker_url=BaseConfig.CELERY_BROKER_URL,
        result_backend=BaseConfig.CELERY_RESULT_BACKEND,
        task_ignore_result=True,
    ),
)

initialize_db(app)

# ExpressionMatrix.drop_collection()
# ExpressionValue.drop_collection()
# BioSample.drop_collection()
# SequenceFeature.drop_collection()

celery_app = celery_init_app(app)

initialize_api(app)
