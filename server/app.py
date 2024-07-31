from flask import Flask
from config import BaseConfig
from db import initialize_db
from rest import initialize_api

app = Flask(__name__)

app.config.from_object(BaseConfig)


initialize_db(app)

initialize_api(app)
