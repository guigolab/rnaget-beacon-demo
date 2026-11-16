from enum import Enum
from typing import Any, Dict, List, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator


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


_FLAT_REQUEST_PARAMETER_LEAVES = frozenset(
    {
        "featureIDList",
        "biosampleIDList",
        "minValue",
        "maxValue",
        "order",
    }
)


class ExpressionValueRequestParameters(BaseModel):
    """Leaf params under query.requestParameters.expressionValue."""

    model_config = ConfigDict(extra="forbid")

    featureIDList: Optional[str] = Field(
        None,
        description="Comma-separated feature IDs (matrix row accessions).",
    )
    biosampleIDList: Optional[str] = Field(
        None,
        description="Comma-separated biosample IDs.",
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
        description="Order expression_values by cell value: asc | desc (default desc).",
    )


class BeaconRequestParameters(BaseModel):
    """RNAget requestParameters under query.requestParameters.

    Beacon framework requires each additional property to be an object.
    Nest leaf slice fields under an entry-type key. Only ``expressionValue``
    is defined (matrices/requestParameters.yaml); the other entry types define
    no request parameters.
    """

    model_config = ConfigDict(extra="forbid")

    expressionValue: Optional[ExpressionValueRequestParameters] = None

    @model_validator(mode="before")
    @classmethod
    def _reject_flat_leaf_keys(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        flat = _FLAT_REQUEST_PARAMETER_LEAVES & set(data.keys())
        if flat:
            raise ValueError(
                "use query.requestParameters.expressionValue for "
                + ", ".join(sorted(flat))
                + "; flat leaf keys are not accepted"
            )
        return data


class BeaconQuery(BaseModel):
    requestedGranularity: Optional[Granularity] = None
    pagination: Optional[Pagination] = None
    # Beacon anyOf OntologyFilter | AlphanumericFilter | CustomFilter
    filters: Optional[List[BeaconFilter]] = None
    requestParameters: Optional[BeaconRequestParameters] = None
    includeResultsetResponses: Optional[IncludeResultsetResponses] = None
    testMode: Optional[bool] = None


class BeaconRequestMeta(BaseModel):
    apiVersion: str


class ReceivedRequestSummary(BaseModel):
    """Beacon receivedRequestSummary (extra echo fields allowed)."""

    model_config = ConfigDict(extra="allow")

    apiVersion: str
    requestedSchemas: List[Dict[str, str]]
    pagination: Dict[str, Any]
    requestedGranularity: Granularity


class InformationalMeta(BaseModel):
    """Beacon response meta for informational endpoints."""

    apiVersion: str
    beaconId: str
    returnedSchemas: List[Dict[str, str]]


class ResponseMeta(InformationalMeta):
    """Beacon response meta for query results and errors."""

    returnedGranularity: Granularity
    receivedRequestSummary: ReceivedRequestSummary


class ResponseSummary(BaseModel):
    exists: bool
    numTotalResults: Optional[int] = None


class ResultsetInstance(BaseModel):
    id: str
    setType: str
    exists: bool
    resultsCount: Optional[int] = None
    # Entity items: Matrix | GenomicFeature | Biosample | ExpressionValue
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


class BeaconOrganization(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    name: str


class BeaconInfoBody(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    name: str
    apiVersion: str
    environment: str
    organization: BeaconOrganization
    description: Optional[str] = None


class BeaconInfoResponse(BaseModel):
    meta: InformationalMeta
    response: BeaconInfoBody


class BeaconConfigurationBody(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)

    schema_: str = Field(..., alias="$schema")
    maturityAttributes: Dict[str, Any]
    securityAttributes: Optional[Dict[str, Any]] = None
    entryTypes: Dict[str, Any]


class BeaconConfigurationResponse(BaseModel):
    meta: InformationalMeta
    response: BeaconConfigurationBody


class BeaconMapBody(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)

    schema_: str = Field(..., alias="$schema")
    endpointSets: Dict[str, Any]


class BeaconMapResponse(BaseModel):
    meta: InformationalMeta
    response: BeaconMapBody


class BeaconEntryTypesBody(BaseModel):
    entryTypes: Dict[str, Any]


class BeaconEntryTypesResponse(BaseModel):
    meta: InformationalMeta
    response: BeaconEntryTypesBody


class ServiceInfoType(BaseModel):
    group: str
    artifact: str
    version: str


class ServiceInfoOrganization(BaseModel):
    name: str
    url: str


class ServiceInfo(BaseModel):
    """GA4GH service-info (bare object, not a Beacon envelope)."""

    model_config = ConfigDict(extra="allow")

    id: str
    name: str
    type: ServiceInfoType
    organization: ServiceInfoOrganization
    version: str
    description: Optional[str] = None
    environment: Optional[str] = None


class FilteringTermItem(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    type: str
    label: Optional[str] = None
    scopes: Optional[List[str]] = None
    values: Optional[List[str]] = None


class FilteringResource(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    name: Optional[str] = None
    url: Optional[str] = None
    nameSpacePrefix: Optional[str] = None
    iriPrefix: Optional[str] = None


class FilteringTermsPayload(BaseModel):
    filteringTerms: List[FilteringTermItem] = Field(default_factory=list)
    resources: List[FilteringResource] = Field(default_factory=list)


class BeaconFilteringTermsResponse(BaseModel):
    meta: InformationalMeta
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

def _informational(model):
    return {
        200: {"description": "Beacon informational response", "model": model},
        400: {"description": "Beacon error", "model": BeaconErrorResponse},
    }


OPENAPI_INFO_RESPONSES = _informational(BeaconInfoResponse)
OPENAPI_CONFIGURATION_RESPONSES = _informational(BeaconConfigurationResponse)
OPENAPI_MAP_RESPONSES = _informational(BeaconMapResponse)
OPENAPI_ENTRY_TYPES_RESPONSES = _informational(BeaconEntryTypesResponse)
OPENAPI_INFORMATIONAL_RESPONSES = OPENAPI_INFO_RESPONSES

OPENAPI_FILTERING_TERMS_RESPONSES = {
    200: {
        "description": "Beacon filtering terms response",
        "model": BeaconFilteringTermsResponse,
    },
    400: {"description": "Beacon error", "model": BeaconErrorResponse},
}
