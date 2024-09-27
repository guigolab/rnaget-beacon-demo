from flask_restful import Resource
from flask import Response, request
from . import biosample_service

class BioSampleApi(Resource):
    def get(self, sample_id):
        biosample_obj=biosample_service.get_biosample(sample_id)
        return Response(biosample_obj.to_json(),mimetype="application/json", status=200)

class BioSamplesApi(Resource):
    def get(self):
        return Response(biosample_service.get_biosamples(request.args), mimetype="application/json", status=200)
    
class BioSampleMatricesApi(Resource):
    def get(self,sample_id):
        return Response(biosample_service.get_related_matrices(sample_id), mimetype="application/json", status=200)
