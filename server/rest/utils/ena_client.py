import requests
import time

def get_taxon_from_ena(taxon_id):
    time.sleep(1)
    response = requests.get(f"https://www.ebi.ac.uk/ena/browser/api/xml/{taxon_id}?download=false") ## 
    if response.status_code != 200:
        return
    return response.content

def get_tolid(taxid):
    time.sleep(1)
    response = requests.get(f"https://id.tol.sanger.ac.uk/api/v2/species/{taxid}").json()
    if not isinstance(response, list):
        return ''
    else:
        return response[0]['prefix']
