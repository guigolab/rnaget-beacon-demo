from db.models import Matrix, Assembly
from jobs import matrix_market, tsv
from helpers import data as data_helper
from fastapi import HTTPException, UploadFile
from celery.result import AsyncResult
import os
import tempfile

USER = os.getenv('USER')
PWD = os.getenv('PWD')

async def launch_matrix_market_job(form_data, mmFile, rowsFile, colsFile):
    check_credentials(form_data)
    parsed_matrix = parse_matrix_payload(form_data)
    matrix_id = parsed_matrix.get('matrixId')

    if Matrix.objects(matrixId=matrix_id).first():
        raise HTTPException(status_code=409, detail=f"{matrix_id} already exists")
    
    mm_file, rows_file, cols_file = await get_matrix_market_files({'mmFile': mmFile, 'rowsFile': rowsFile, 'colsFile': colsFile})
    task = matrix_market.upload_matrix_market.delay(mm_file, rows_file, cols_file, parsed_matrix)
    return dict(id=task.id, state=task.state )

async def launch_tsv_job(form_data, tsv_file):
    check_credentials(form_data)
    parsed_matrix = parse_matrix_payload(form_data)
    matrix_id = parsed_matrix.get('matrixId')

    if Matrix.objects(matrixId=matrix_id).first():
        raise HTTPException(status_code=409, detail=f"{matrix_id} already exists")
    
    tsv_path = await get_tsv_file({'tsv': tsv_file})
    task = tsv.upload_tsv.delay(tsv_path, parsed_matrix)
    return dict(id=task.id, state=task.state)

async def get_tsv_file(files):
    tsv = files.get('tsv')
    if not tsv:
        raise HTTPException(status_code=400, detail=f"tsv file missing")
    return await save_to_tmp_file(tsv)

async def get_matrix_market_files(files):
    matrix_market_fields = ['mmFile', 'rowsFile', 'colsFile']
    data_helper.validate_fields(matrix_market_fields, files)
    results = []
    for field in matrix_market_fields:
        result = await save_to_tmp_file(files[field])
        results.append(result)
    return tuple(results)


def check_credentials(data):
    fields = ['username', 'password']
    data_helper.validate_fields(fields, data)

    user = data.get('username')
    pwd = data.get('password')
    if user != USER or pwd != PWD:
        raise HTTPException(status_code=401, detail=f"Bad username or password")
    
# Save the file to the shared directory
async def save_to_tmp_file(file):
    shared_dir = '/server'
    
    # Ensure the shared directory exists (it should since it's a mounted volume)
    if not os.path.exists(shared_dir):
        os.makedirs(shared_dir)
    # Create a named temporary file in the shared directory
    filename = file.filename if hasattr(file, 'filename') and file.filename else 'uploaded_file'
    suffix = os.path.splitext(filename)[1] if filename else ''
    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=suffix, prefix='tmp_', dir=shared_dir)
    # Save the uploaded file to the temp file path
    content = await file.read()
    temp_file.write(content)
    temp_file.close()
    # Return the absolute path to the temporary file
    return temp_file.name

def parse_matrix_payload(payload):
    # Map old field names to new field names
    field_mapping = {
        'matrixID': 'matrixId',
        'referenceAnnotation': 'annotationUrl',
        'downloadLink': 'downloadUrl'
    }
    
    # Define required fields for new Matrix model
    required_fields = ['matrixId', 'annotationUrl', 'downloadUrl', 'unit', 'assembly']
    
    # Map fields from old names to new names
    matrix_to_save = {}
    for old_field, new_field in field_mapping.items():
        if old_field in payload:
            matrix_to_save[new_field] = payload[old_field]
    
    # Copy other fields that exist in both models
    for field in ['name', 'unit', 'description']:
        if field in payload:
            matrix_to_save[field] = payload[field]
    
    # Handle assembly - if not provided, create a default or get from payload
    if 'assembly' not in matrix_to_save:
        if 'assemblyAccession' in payload and 'assemblyName' in payload:
            matrix_to_save['assembly'] = Assembly(
                accession=payload['assemblyAccession'],
                name=payload['assemblyName']
            )
        else:
            # Default assembly if not provided - you may want to make this required in the form
            matrix_to_save['assembly'] = Assembly(accession='', name='')
    
    # Validate required fields
    data_helper.validate_fields(['matrixId', 'annotationUrl', 'downloadUrl', 'unit', 'assembly'], matrix_to_save)
    
    # Extract optional fields if present
    optional_fields = ['description', 'taxID', 'featuresCount', 'biosamplesCount', 'createDateTime']
    for field in optional_fields:
        if field in payload:
            matrix_to_save[field] = payload[field]
    
    return matrix_to_save

async def get_task_status(task_id):
    task = AsyncResult(task_id)
    if task.result:
        print(task.result)
        return dict(messages=task.result['messages'], state=task.state )
    raise HTTPException(status_code=404, detail=f'{task_id} not found')