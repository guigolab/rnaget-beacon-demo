from enum import Enum
from typing import Any, Dict, List, Optional, Union

from pydantic import BaseModel, ConfigDict, Field


class Granularity(str, Enum):
    boolean = "boolean"
    count = "count"
    record = "record"


class IncludeResultsetResponses(str, Enum):
    ALL = "ALL"
    HIT = "HIT"
    MISS = "MISS"
    NONE = "NONE"


class Pagination(BaseModel):
    skip: Optional[int] = Field(0, ge=0)
    # 0 means "as many as the server allows" (Beacon v2 Limit).
    limit: Optional[int] = Field(10, ge=0)
    # Opaque Beacon PageToken fields (keyset navigation for expression_values).
    currentPage: Optional[str] = None
    nextPage: Optional[str] = None
    previousPage: Optional[str] = None


class OntologyFilter(BaseModel):
    id: str
    scope: Optional[str] = None
    includeDescendantTerms: Optional[bool] = True
    similarity: Optional[str] = "exact"


class AlphanumericFilter(BaseModel):
    id: str
    operator: str = "="
    value: Union[str, int, float]
    scope: Optional[str] = None


class CustomFilter(BaseModel):
    id: str
    scope: Optional[str] = None


# Alphanumeric first so operator+value requests don't collapse to OntologyFilter.
BeaconFilter = Union[AlphanumericFilter, OntologyFilter, CustomFilter]


class BeaconRequestParameters(BaseModel):
    """RNAget requestParameters under query.requestParameters.

    Route-specific: nested matrix features → featureIDList only; nested
    biosamples → biosampleIDList only; expression_values → both ID lists,
    minValue/maxValue, and order (by cell value). Cross-links use matrixIDList.
    """

    model_config = ConfigDict(extra="forbid")

    featureIDList: Optional[str] = Field(
        None,
        description="Comma-separated feature IDs (matrix row accessions).",
    )
    biosampleIDList: Optional[str] = Field(
        None,
        description="Comma-separated biosample IDs.",
    )
    matrixIDList: Optional[str] = Field(
        None,
        description="Comma-separated matrix IDs (cross-link listings).",
    )
    minValue: Optional[float] = Field(
        None,
        description="Minimum expression value (expression_values only).",
    )
    maxValue: Optional[float] = Field(
        None,
        description="Maximum expression value (expression_values only).",
    )
    order: Optional[str] = Field(
        None,
        description="Order expression_values by cell value: asc | desc.",
    )


class BeaconQuery(BaseModel):
    requestedGranularity: Optional[Granularity] = None
    pagination: Optional[Pagination] = None
    # Beacon anyOf OntologyFilter | AlphanumericFilter | CustomFilter
    filters: Optional[List[BeaconFilter]] = None
    requestParameters: Optional[BeaconRequestParameters] = None
    includeResultsetResponses: Optional[IncludeResultsetResponses] = None
    testMode: Optional[bool] = None


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
