from flask_restful import Resource
from flask import Response
from db.models import CronJob
from db.enums import CronJobStatus
from flask_jwt_extended import jwt_required
from errors import NotFound, RecordAlreadyExistError
from . import cronjob_service

CRONJOB_TYPES = ['import_assemblies']

## persist cronjob status
class CronJobApi(Resource):

    def get(self):
        CronJob.objects().delete()
        cronjob = CronJob.objects().to_json()
        return Response(cronjob, mimetype="application/json", status=200)

    #create cronjob
    @jwt_required()
    def post(self, model):
        if not model in CRONJOB_TYPES:
            raise NotFound
        cronjob = CronJob.objects(cronjob_type=model).first()
        if cronjob:
            raise RecordAlreadyExistError
        cronjob = CronJob(cronjob_type=model, status= CronJobStatus.PENDING)
        if model == 'import_assemblies':
            cronjob_service.import_assemblies()
            cronjob.save()
            return Response(cronjob.to_json(), mimetype="application/json", status=201)
        else:
            return Response({'message': 'field not found'}.to_json(), mimetype="application/json", status=400)


