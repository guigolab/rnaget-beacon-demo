from . import db
import datetime
from .enums import CronJobStatus, Roles


def handler(event):
    """Signal decorator to allow use of callback functions as class decorators."""
    def decorator(fn):
        def apply(cls):
            event.connect(fn, sender=cls)
            return cls
        fn.apply = apply
        return fn
    return decorator

class TaxonNode(db.Document):
    children = db.ListField(db.StringField()) #stores taxids
    name = db.StringField(required=True)
    taxid = db.StringField(required= True,unique=True)
    rank = db.StringField()
    leaves = db.IntField()
    meta = {
        'indexes': [
            'taxid'
        ]
    }

class Assembly(db.Document):
    accession = db.StringField(unique=True)
    assembly_name=db.StringField()
    scientific_name= db.StringField()
    taxid = db.StringField(required=True)
    sample_accession=db.StringField()
    created = db.DateTimeField(default=datetime.datetime.utcnow)
    metadata=db.DictField()
    chromosomes=db.ListField(db.StringField())
    meta = {
        'indexes': ['accession']
    }

class Chromosome(db.Document):
    accession_version = db.StringField(required=True,unique=True)
    metadata=db.DictField()

class GenomeAnnotation(db.Document):
    assembly_accession = db.StringField(required=True)
    assembly_name = db.StringField()
    taxid = db.StringField(required=True)
    scientific_name = db.StringField(required=True)
    name = db.StringField(required=True,unique=True)
    gff_gz_location = db.URLField(required=True)
    tab_index_location = db.URLField(required=True)
    created = db.DateTimeField(default=datetime.datetime.utcnow)
    metadata=db.DictField()
    user=db.StringField()
   
@handler(db.post_delete)
def delete_related_data( sender, document ):
    taxid = document.taxid
    Assembly.objects(taxid=taxid).delete()
    GenomeAnnotation.objects(taxid=taxid).delete()
    taxons = TaxonNode.objects(taxid__in=document.taxon_lineage)
    for node in taxons:
        node.leaves=node.leaves - 1
        if node.leaves <= 0:
            TaxonNode.objects(children=node.taxid).update_one(pull__children=node.taxid)
            node.delete()
        else:
            node.save()


@delete_related_data.apply
class Organism(db.Document):
    assemblies = db.ListField(db.StringField())
    metadata = db.DictField()
    tolid_prefix = db.StringField()
    links = db.ListField(db.URLField())
    annotations = db.ListField(db.StringField())
    insdc_common_name = db.StringField()
    scientific_name = db.StringField(required=True,unique=True)
    taxid = db.StringField(required= True,unique=True)
    image = db.URLField()
    image_urls = db.ListField(db.URLField())
    taxon_lineage = db.ListField(db.StringField())
    meta = {
        'indexes': [
            'scientific_name',
            'insdc_common_name',
            'tolid_prefix',
            'taxid'
        ],
        'strict': False
    }

class CronJob(db.Document):
    status = db.EnumField(CronJobStatus, required=True)
    cronjob_type = db.StringField(required=True,unique=True)

class BioGenomeUser(db.Document):
    name=db.StringField(unique=True,required=True)
    password=db.StringField(required=True)
    role=db.EnumField(Roles, required=True)

# # Store user queries here, ref to file model
# # Queries are deleted after pipeline submission
# class GeneidQuery(db.Document):
#     user_mail = db.StringField(required=True)
#     geneid_params = db.DictField()

# # store responses here
# # delete them after 24h
# class GeneidResponse(db.Document):

