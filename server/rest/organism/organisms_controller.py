from . import organisms_service
from flask import Response, request
from db.models import Organism,TaxonNode,Assembly,GenomeAnnotation
from flask_restful import Resource
from errors import NotFound
import json
from flask_jwt_extended import jwt_required


MODEL_LIST = {
    'assemblies':Assembly,
    'annotations':GenomeAnnotation,
    'organisms':Organism,
    }

class OrganismsApi(Resource):

	def get(self):
		total, data = organisms_service.get_organisms(**request.args)
		json_resp = dict(total=total,data=list(data.as_pymongo()))
		return Response(json.dumps(json_resp), mimetype="application/json", status=200)
    
	@jwt_required()
	def post(self):
		data = request.json if request.is_json else request.form
		new_organism = organisms_service.parse_organism_data(data)
		return Response(new_organism.to_json(),mimetype="application/json", status=201)

class OrganismApi(Resource):
	def get(self, taxid):
		organism_obj = Organism.objects(taxid=taxid).first()
		if not organism_obj:
			raise NotFound
		return Response(organism_obj.to_json(),mimetype="application/json", status=200)

	##update organism
	@jwt_required()
	def put(self,taxid):
		data = request.json if request.is_json else request.form
		updated_organism = organisms_service.parse_organism_data(data,taxid)
		return Response(updated_organism.to_json(),mimetype="application/json", status=201)
	
	@jwt_required()
	def delete(self,taxid):
		organism = Organism.objects(taxid=taxid).first()
		name = organism.scientific_name
		if not organism:
			raise NotFound
		organism.delete()
		return Response(json.dumps(f'{name} and its related data have been deleted'),mimetype="application/json", status=201)

class OrganismRelatedDataApi(Resource):
	def get(self, taxid, model):
		organism_obj = Organism.objects(taxid=taxid).first()
		if not organism_obj or not model in MODEL_LIST.keys():
			raise NotFound
		items = organisms_service.get_organism_related_data(taxid, MODEL_LIST[model])
		return Response(items.to_json(),mimetype="application/json", status=200)

class OrganismLineageApi(Resource):
	def get(self,taxid):
		organism_obj = Organism.objects(taxid=taxid).first()
		if not organism_obj:
			raise NotFound
		ordered_taxid_lineage = organism_obj.taxon_lineage
		lineage_from_model = TaxonNode.objects(taxid__in=ordered_taxid_lineage).exclude('id','children').as_pymongo()
		parsed_lineage = list()
		for l_taxid in ordered_taxid_lineage:
			parsed_lineage.append(next(f for f in lineage_from_model if f['taxid'] == l_taxid ))
		taxon_lineage = list(reversed(parsed_lineage))
		return Response(json.dumps(taxon_lineage),mimetype="application/json", status=200)
