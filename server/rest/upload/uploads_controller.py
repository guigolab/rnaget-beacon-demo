from fastapi import Response, File, UploadFile, Form
from typing import Optional
from . import uploads_service
import json

async def check_job_status(task_id: str):
    response = await uploads_service.get_task_status(task_id)
    return Response(content=json.dumps(response), media_type="application/json", status_code=200)

async def upload_matrix_market(
    mmFile: UploadFile = File(...),
    rowsFile: UploadFile = File(...),
    colsFile: UploadFile = File(...),
    username: str = Form(...),
    password: str = Form(...),
    matrixID: str = Form(...),
    name: str = Form(...),
    referenceAnnotation: str = Form(...),
    unit: str = Form(...),
    description: Optional[str] = Form(None),
    taxID: Optional[str] = Form(None),
    downloadLink: Optional[str] = Form(None),
    assemblyAccession: Optional[str] = Form(None),
    assemblyName: Optional[str] = Form(None)
):
    form_data = {
        'username': username,
        'password': password,
        'matrixID': matrixID,
        'name': name,
        'referenceAnnotation': referenceAnnotation,
        'unit': unit,
    }
    if description:
        form_data['description'] = description
    if taxID:
        form_data['taxID'] = taxID
    if downloadLink:
        form_data['downloadLink'] = downloadLink
    if assemblyAccession:
        form_data['assemblyAccession'] = assemblyAccession
    if assemblyName:
        form_data['assemblyName'] = assemblyName
    
    resp = await uploads_service.launch_matrix_market_job(form_data, mmFile, rowsFile, colsFile)
    return Response(content=json.dumps(resp), media_type="application/json", status_code=200)

async def upload_tsv(
    tsv: UploadFile = File(...),
    username: str = Form(...),
    password: str = Form(...),
    matrixID: str = Form(...),
    name: str = Form(...),
    referenceAnnotation: str = Form(...),
    unit: str = Form(...),
    description: Optional[str] = Form(None),
    taxID: Optional[str] = Form(None),
    downloadLink: Optional[str] = Form(None),
    assemblyAccession: Optional[str] = Form(None),
    assemblyName: Optional[str] = Form(None)
):
    form_data = {
        'username': username,
        'password': password,
        'matrixID': matrixID,
        'name': name,
        'referenceAnnotation': referenceAnnotation,
        'unit': unit,
    }
    if description:
        form_data['description'] = description
    if taxID:
        form_data['taxID'] = taxID
    if downloadLink:
        form_data['downloadLink'] = downloadLink
    if assemblyAccession:
        form_data['assemblyAccession'] = assemblyAccession
    if assemblyName:
        form_data['assemblyName'] = assemblyName
    
    resp = await uploads_service.launch_tsv_job(form_data, tsv)
    return Response(content=json.dumps(resp), media_type="application/json", status_code=200)

