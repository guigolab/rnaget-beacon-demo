from flask_restful import Resource
from flask import Response, request
from . import matrix_service

class MatricesApi(Resource):
    def get(self):
        return Response(matrix_service.get_matrices(request.args), mimetype="application/json", status=200)

class MatrixApi(Resource):
    def get(self,matrix_id):
        matrix = matrix_service.get_matrix(matrix_id)
        return Response(matrix.to_json(),mimetype="application/json", status=200)

class MatrixBiosamplesApi(Resource):
    def get(self, matrix_id):
        return Response(matrix_service.get_related_biosamples(matrix_id), mimetype="application/json", status=200)

class MatrixFeaturesApi(Resource):
    def get(self, matrix_id):
        return Response(matrix_service.get_related_features(matrix_id), mimetype="application/json", status=200)

class MatrixExpressionValuesApi(Resource):
    def get(self, matrix_id):
        return Response(matrix_service.get_expression_values(matrix_id, **request.args), mimetype="application/json", status=200)

