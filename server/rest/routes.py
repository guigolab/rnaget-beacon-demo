from .user import users_controller
from .assembly import assemblies_controller
from .organism import organisms_controller
from .taxon import taxons_controller
from .annotation import annotations_controller
from .dump import dumps_controller
from .cronjob import cronjobs_controller
from .stats import stats_controller
from .taxonomy import taxonomy_controller

def initialize_routes(api):

	##ADMIN
	api.add_resource(users_controller.LoginApi, '/api/login')
	api.add_resource(users_controller.LogoutApi, '/api/logout')
	api.add_resource(cronjobs_controller.CronJobApi, '/api/cronjob', '/api/cronjob/<model>')
	api.add_resource(dumps_controller.DumpApi, '/api/dumps/<model>')

	##TAXONOMY
	api.add_resource(taxonomy_controller.TreeApi,'/api/tree', '/api/tree/<taxid>')
	api.add_resource(taxonomy_controller.TreeStatusApi,'/api/tree/<taxid>/status')
	api.add_resource(taxonomy_controller.TreeLevelsApi, '/api/tree_levels', '/api/tree_levels/<taxid>')
	api.add_resource(taxonomy_controller.TaxonomyTreeApi, '/api/taxonomy_tree/<taxid>') 
	api.add_resource(taxonomy_controller.RelativeTaxonomyTreeApi, '/api/tree/<taxid>/relative') 

	##ANNOTATIONS
	api.add_resource(annotations_controller.AnnotationsApi, '/api/annotations')
	api.add_resource(annotations_controller.AnnotationApi,  '/api/annotations/<name>')

	##ASSEMBLIES
	api.add_resource(assemblies_controller.AssembliesApi, '/api/assemblies')
	api.add_resource(assemblies_controller.AssemblyApi,  '/api/assemblies/<accession>')
	api.add_resource(assemblies_controller.AssemblyRelatedAnnotationsApi, '/api/assemblies/<accession>/annotations')

	##ORGANISMS
	api.add_resource(organisms_controller.OrganismsApi, '/api/organisms')
	api.add_resource(organisms_controller.OrganismApi, '/api/organisms/<taxid>')
	api.add_resource(organisms_controller.OrganismLineageApi, '/api/organisms/<taxid>/lineage')
	api.add_resource(organisms_controller.OrganismRelatedDataApi, '/api/organisms/<taxid>/<model>') 

	##TAXONS
	api.add_resource(taxons_controller.TaxonsApi, '/api/taxons')
	api.add_resource(taxons_controller.TaxonApi, '/api/taxons/<taxid>')
	api.add_resource(taxons_controller.TaxonChildrenApi, '/api/taxons/<taxid>/children')

	##USERS
	api.add_resource(users_controller.UsersApi, '/api/users')
	api.add_resource(users_controller.UserApi,'/api/users/<name>')

	##STATS TODO: IMPROVE IT.. 
	api.add_resource(stats_controller.StatsApi,'/api/stats')
	api.add_resource(stats_controller.FieldStatsApi, '/api/stats/<model>')



