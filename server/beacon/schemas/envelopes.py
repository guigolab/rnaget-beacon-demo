from enum import Enum
from typing import Any, Dict, List, Optional, Union

from pydantic import BaseModel, Field


class Granularity(str, Enum):
    boolean = "boolean"
    count = "count"
    record = "record"


class ResponseMeta(BaseModel):
    apiVersion: str
    beaconId: str
    returnedGranularity: Optional[Granularity] = None
    returnedSchemas: List[Dict[str, str]] = Field(default_factory=list)
    receivedRequestSummary: Optional[Dict[str, Any]] = None


class ResponseSummary(BaseModel):
    exists: bool
    numTotalResults: Optional[int] = None


class ResultsetInstance(BaseModel):
    id: str
    setType: str
    exists: bool
    resultsCount: Optional[int] = None
    results: Optional[List[Dict[str, Any]]] = None


class ResultsetsPayload(BaseModel):
    resultSets: List[ResultsetInstance]


class BeaconResultsetsResponse(BaseModel):
    meta: ResponseMeta
    responseSummary: ResponseSummary
    response: ResultsetsPayload


class BeaconCountResponse(BaseModel):
    meta: ResponseMeta
    responseSummary: ResponseSummary


class BeaconBooleanResponse(BaseModel):
    meta: ResponseMeta
    responseSummary: ResponseSummary


class BeaconErrorBody(BaseModel):
    errorCode: int
    errorMessage: str


class BeaconErrorResponse(BaseModel):
    meta: ResponseMeta
    error: BeaconErrorBody


BeaconSuccessResponse = Union[
    BeaconResultsetsResponse, BeaconCountResponse, BeaconBooleanResponse
]


# Used by routers for OpenAPI documentation (actual return is a plain dict / JSONResponse).
OPENAPI_BEACON_RESPONSES = {
    200: {
        "description": "Beacon success response (boolean, count, or resultsets by granularity)",
        "model": BeaconResultsetsResponse,
    },
    400: {"description": "Beacon error", "model": BeaconErrorResponse},
    404: {"description": "Beacon error", "model": BeaconErrorResponse},
}
