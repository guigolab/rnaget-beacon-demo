import os

BEACON_ID = os.environ.get("BEACON_ID", "org.crg.rnaget-beacon")
API_VERSION = os.environ.get("BEACON_API_VERSION", "v2.0.0")
BEACON_NAME = os.environ.get("BEACON_NAME", "RNAget Beacon Demo")
BEACON_DESCRIPTION = os.environ.get(
    "BEACON_DESCRIPTION",
    "Demo Beacon v2 instance exposing RNA-seq matrices, genomic features, "
    "biosamples, and expression values (fixture-backed).",
)
BEACON_ENVIRONMENT = os.environ.get("BEACON_ENVIRONMENT", "dev")
BASE_URL = os.environ.get(
    "BEACON_BASE_URL",
    "https://genome.crg.es/rnaget-beacon",
).rstrip("/")

ORGANIZATION = {
    "id": os.environ.get("BEACON_ORG_ID", "org.crg"),
    "name": os.environ.get("BEACON_ORG_NAME", "Centre for Genomic Regulation (CRG)"),
}

SCHEMA_IDS = {
    "biosample": "ga4gh-beacon-biosample-v2.0.0",
    "feature": "ga4gh-beacon-feature-v2.1.2",
    "matrix": "ga4gh-beacon-matrix-v2.1.2",
    "expressionValue": "ga4gh-beacon-expressionValues-v2.0.0",
    "info": "beacon-info-v2.0.0",
    "configuration": "beacon-configuration-v2.0.0",
    "map": "beacon-map-v2.0.0",
    "entryTypes": "beacon-entry-types-v2.0.0",
    "filteringTerms": "beacon-filtering-terms-v2.0.0",
}

# Enable legacy Mongo/Celery upload routes when set to "1"/"true"
ENABLE_LEGACY_UPLOADS = os.environ.get("ENABLE_LEGACY_UPLOADS", "0").lower() in (
    "1",
    "true",
    "yes",
)
