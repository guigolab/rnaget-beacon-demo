from enum import Enum
from typing import Any, Dict, List, Optional, Union

from pydantic import BaseModel, Field


class Granularity(str, Enum):
    boolean = "boolean"
    count = "count"
    record = "record"


class Pagination(BaseModel):
    skip: Optional[int] = Field(0, ge=0)
    limit: Optional[int] = Field(10, ge=1)


class BeaconQuery(BaseModel):
    requestedGranularity: Optional[Granularity] = None
    pagination: Optional[Pagination] = None


class BeaconRequestMeta(BaseModel):
    apiVersion: Optional[str] = None


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
    # Entity items: Matrix | GenomicFeatureWrapper | Biosample | ExpressionValue
    # (wired to beacon-schemas via custom OpenAPI).
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


class BeaconInformationalResponse(BaseModel):
    meta: ResponseMeta
    response: Dict[str, Any]


class FilteringTermsPayload(BaseModel):
    filteringTerms: List[Dict[str, Any]] = Field(default_factory=list)
    resources: List[Dict[str, Any]] = Field(default_factory=list)


class BeaconFilteringTermsResponse(BaseModel):
    meta: ResponseMeta
    response: FilteringTermsPayload


BeaconSuccessResponse = Union[
    BeaconResultsetsResponse, BeaconCountResponse, BeaconBooleanResponse
]


# Used by routers for OpenAPI documentation (actual return is a plain dict / JSONResponse).
OPENAPI_BEACON_RESPONSES = {
    200: {
        "description": "Beacon success response (boolean, count, or resultSets by granularity)",
        "content": {
            "application/json": {
                "schema": {
                    "oneOf": [
                        {"$ref": "#/components/schemas/BeaconBooleanResponse"},
                        {"$ref": "#/components/schemas/BeaconCountResponse"},
                        {"$ref": "#/components/schemas/BeaconResultsetsResponse"},
                    ]
                }
            }
        },
    },
    400: {"description": "Beacon error", "model": BeaconErrorResponse},
    404: {"description": "Beacon error", "model": BeaconErrorResponse},
}

OPENAPI_INFORMATIONAL_RESPONSES = {
    200: {
        "description": "Beacon informational response",
        "model": BeaconInformationalResponse,
    },
}

OPENAPI_FILTERING_TERMS_RESPONSES = {
    200: {
        "description": "Beacon filtering terms response",
        "model": BeaconFilteringTermsResponse,
    },
}
