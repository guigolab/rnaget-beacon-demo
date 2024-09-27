from db.models import ExpressionMatrix
from werkzeug.exceptions import BadRequest, Conflict, NotFound
from jobs import upload_matrix_market, upload_tsv
from celery.result import AsyncResult
import tempfile

def launch_matrix_market_job(request):

    parsed_matrix = parse_post_request(request)

    mm_file, rows_file, cols_file = get_matrix_market_files(request.files)
    #launch job
    task = upload_matrix_market.upload_matrix_market.delay(mm_file, rows_file, cols_file, parsed_matrix)
    return dict(id=task.id, state=task.state )

def launch_tsv_job(request):
    parsed_matrix = parse_post_request(request)

    task = upload_tsv.upload_tsv.delay(get_tsv_file(request.files), parsed_matrix)
    return dict(id=task.id, state=task.state)

def get_tsv_file(files):
    tsv = files.get('tsv')
    if not tsv:
        raise BadRequest(description=f"tsv file missing")
    return save_to_tmp_file(tsv)

def get_matrix_market_files(files):
    matrix_market_fields = ['mmFile', 'rowsFile', 'colsFile']

    missing_fields = [field for field in matrix_market_fields if field not in files]

    if missing_fields:
        raise BadRequest(description=f"Missing required files: {', '.join(missing_fields)}")
    
    return tuple(save_to_tmp_file(files[field]) for field in matrix_market_fields)

def parse_post_request(request):
    data = request.json if request.is_json else request.form

    parsed_matrix = parse_matrix_payload(data)
    matrix_id = parsed_matrix.matrixID

    if ExpressionMatrix.objects(matrixID=matrix_id).first():
        raise Conflict(description=f"{matrix_id} already exists")
    
    return parsed_matrix

def save_to_tmp_file(file):
    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=file.filename)
    file.save(temp_file.name)
    return temp_file.name

def parse_matrix_payload(payload):
    # Define required and optional fields
    required_fields = ['matrixID', 'name', 'referenceAnnotation']
    optional_fields = ['description', 'taxID', 'downloadLink']

    # Validate and extract required fields
    matrix_to_save = {field: payload[field] for field in required_fields if payload.get(field) is not None}

    # Ensure all required fields are present
    missing_fields = [field for field in required_fields if field not in matrix_to_save]
    if missing_fields:
        raise BadRequest(description=f"Missing required fields: {', '.join(missing_fields)}")

    # Extract optional fields if present
    matrix_to_save.update({field: payload[field] for field in optional_fields if payload.get(field)})

    return ExpressionMatrix(**matrix_to_save)

def get_task_status(task_id):
    task = AsyncResult(task_id)
    if task.result:
        print(task.result)
        return dict(messages=task.result['messages'], state=task.state )
    raise NotFound(description=f'{task_id} not found')