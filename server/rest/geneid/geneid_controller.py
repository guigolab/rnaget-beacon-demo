from flask import Response, request
from flask import current_app as app
from db.models import GeneIdResults
from flask_restful import Resource
from services import geneid_service
from mongoengine.errors import ValidationError, DoesNotExist
from errors import InternalServerError, SchemaValidationError, NotFound




class GeneIdServerApi(Resource):
    #get param files for formulary
    def get(self,id):
        try:
            result_model = GeneIdResults.objects(id = id).first()
            return Response(result_model.to_json(),mimetype="application/json", status=200)
        except DoesNotExist:
            raise NotFound
        except Exception as e:
            app.logger.error(e)
        raise InternalServerError

    def post(self):
        try:
            # app.logger.info(request)
            # app.logger.info(request.__dict__)
            app.logger.info(request.remote_addr)
            app.logger.info(request.url_root)
            app.logger.info(request.access_route)
            data = request.form
            files = request.files
            if not 'fasta' in files.keys():
                raise SchemaValidationError
            geneid_params = geneid_service.parse_params(data,files)
            ##parse params
            ## run geneid
            ## run gff2ps
            app.logger.info("PASSING HERE")
            # geneid_result = service.programs_configs(data,files)
            # if geneid_result:
            #     #create stat object
            #     if geneid_result.ps:
            #         gff2ps=True
            #     else:
            #         gff2ps=False
            #     # stats = GeneIdStats(ip=request.remote_addr,run_time=geneid_result.geneid_cmd,gff2ps=gff2ps)
            #     # app.logger.info(geneid_result.to_json())
            # # list_response = []
            # # for file in output_files:
            # #     list_response.append(file.name) ## we pass the path of the files to the client (an interval scheduler will remove them)
            #     return Response(geneid_result.to_json(), mimetype="application/json", status=200)
            # else:
            #     return 'something passed..', 500
        except ValidationError:
            raise SchemaValidationError
        except Exception as e:
            app.logger.error(e)
        raise InternalServerError

    def delete(self,id):
        geneid = GeneIdResults.objects.get(id=id)
        if geneid.jpg:
            geneid.jpg.delete()
        if geneid.ps:
            geneid.ps.delete()
        geneid.delete()
        return '', 200


# class ResultFilesApi(Resource):
#     def get(self, id):
#         try:
#             file = ResultFiles.objects(id=id).first()
#             app.logger.info(file)
#             return Response(file.file.read(), content_type=file.type, status=200)
#         except DoesNotExist:
#             raise NotFound
#         except Exception as e:
#             app.logger.error(e)
#         raise InternalServerError