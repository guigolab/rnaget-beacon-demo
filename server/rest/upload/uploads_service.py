from db.models import ExpressionMatrix
from jobs import matrix_market, tsv
from helpers import data as data_helper
from werkzeug.exceptions import BadRequest, Conflict, NotFound, Unauthorized
from celery.result import AsyncResult
import os
import tempfile

USER = os.getenv('USER')
PWD = os.getenv('PWD')

def launch_matrix_market_job(request):
    parsed_matrix = parse_post_request(request)
    mm_file, rows_file, cols_file = get_matrix_market_files(request.files)
    task = matrix_market.upload_matrix_market.delay(mm_file, rows_file, cols_file, parsed_matrix)
    return dict(id=task.id, state=task.state )

def launch_tsv_job(request):
    parsed_matrix = parse_post_request(request)
    tsv_file = get_tsv_file(request.files)
    task = tsv.upload_tsv.delay(tsv_file, parsed_matrix)
    return dict(id=task.id, state=task.state)

def get_tsv_file(files):
    tsv = files.get('tsv')
    if not tsv:
        raise BadRequest(description=f"tsv file missing")
    return save_to_tmp_file(tsv)

def get_matrix_market_files(files):
    matrix_market_fields = ['mmFile', 'rowsFile', 'colsFile']
    data_helper.validate_fields(matrix_market_fields, files)
    return tuple(save_to_tmp_file(files[field]) for field in matrix_market_fields)

def parse_post_request(request):
    data = request.json if request.is_json else request.form

    check_credentials(data)
    parsed_matrix = parse_matrix_payload(data)
    matrix_id = parsed_matrix.get('matrixID')

    if ExpressionMatrix.objects(matrixID=matrix_id).first():
        raise Conflict(description=f"{matrix_id} already exists")
    
    return parsed_matrix

def check_credentials(data):
    fields = ['username', 'password']
    data_helper.validate_fields(fields, data)

    user = data.get('username')
    pwd = data.get('password')
    if user != USER or pwd != PWD:
        raise Unauthorized(description=f"Bad username or password")
    
# Save the file to the shared directory
def save_to_tmp_file(file):
    shared_dir = '/server'
    
    # Ensure the shared directory exists (it should since it's a mounted volume)
    if not os.path.exists(shared_dir):
        os.makedirs(shared_dir)
    # Create a named temporary file in the shared directory
    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=file.filename, dir=shared_dir)
    # Save the uploaded file to the temp file path
    file.save(temp_file.name)
    # Return the absolute path to the temporary file
    return temp_file.name

def parse_matrix_payload(payload):
    # Define required and optional fields
    required_fields = ['matrixID', 'name', 'referenceAnnotation', 'unit']
    optional_fields = ['description', 'taxID', 'downloadLink']

    # Validate and extract required fields
    matrix_to_save = {field: payload[field] for field in required_fields if payload.get(field) is not None}

    data_helper.validate_fields(required_fields, matrix_to_save)
    # Extract optional fields if present
    matrix_to_save.update({field: payload[field] for field in optional_fields if payload.get(field)})
    return matrix_to_save

def get_task_status(task_id):
    task = AsyncResult(task_id)
    if task.result:
        print(task.result)
        return dict(messages=task.result['messages'], state=task.state )
    raise NotFound(description=f'{task_id} not found')