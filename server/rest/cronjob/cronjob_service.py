from db.models import Organism, Assembly
from ..utils import ena_client
from ..organism import organisms_service
from ..assembly import assemblies_service
from decimal import Decimal
import time
import os
import requests
import json

def import_assemblies():
    project_accession = os.getenv('PROJECT_ACCESSION')
    if not project_accession:
        return
    fetched_assemblies=list()
    result = requests.get(f"https://api.ncbi.nlm.nih.gov/datasets/v1/genome/bioproject/{project_accession}?filters.reference_only=false&filters.assembly_source=all&page_size=100").json()
    counter = 1
    print('Importing Assemblies')
    if 'assemblies' in result.keys():
        while 'next_page_token' in result.keys():
            fetched_assemblies.extend([ass['assembly'] for ass in result['assemblies']])
            next_page_token = result['next_page_token']
            #max 3 requests per second without auth token
            if counter >= 3:
                time.sleep(1)
                counter = 0
            result = requests.get(f"https://api.ncbi.nlm.nih.gov/datasets/v1/genome/bioproject/{project_accession}?filters.reference_only=false&filters.assembly_source=all&page_size=100&page_token={next_page_token}").json()
            counter+=1
        if 'assemblies' in result.keys():
            fetched_assemblies.extend([ass['assembly'] for ass in result['assemblies']])
    if fetched_assemblies:
        accessions = [assembly['assembly_accession'] for assembly in fetched_assemblies]
        existing_assemblies = Assembly.objects(accession__in=accessions).scalar('accession')
        for assembly_to_save in fetched_assemblies:
            assembly_to_save_accession = assembly_to_save['assembly_accession']
            if assembly_to_save_accession in existing_assemblies:
                continue
            print(f'Importing Assembly: {assembly_to_save_accession}')
            saved_assembly = assemblies_service.create_assembly_from_ncbi_data(assembly_to_save)
            if not saved_assembly:
                continue