from flask_restful import Resource
from flask import Response, request
from . import feature_service

class FeatureApi(Resource):
    def get(self, sequence_id):
        biosample_obj=feature_service.get_sequence(sequence_id)
        return Response(biosample_obj.to_json(),mimetype="application/json", status=200)

class FeaturesApi(Resource):
    def get(self):
        return Response(feature_service.get_sequences(request.args), mimetype="application/json", status=200)
    
class FeatureMatricesApi(Resource):
    def get(self,sequence_id):
        return Response(feature_service.get_related_matrices(sequence_id), mimetype="application/json", status=200)
