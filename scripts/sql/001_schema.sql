-- Full seed schema for Beacon RNA-Get demo (Postgres-only).
-- Metadata (matrices, features, biosamples) + expression_values fact table.

CREATE TABLE IF NOT EXISTS matrices (
    matrix_id TEXT PRIMARY KEY,
    name TEXT,
    document JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS features (
    id TEXT PRIMARY KEY,
    native_id TEXT NOT NULL,
    resource TEXT,
    feature_type TEXT,
    document JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_features_native_id
    ON features (native_id);

CREATE TABLE IF NOT EXISTS biosamples (
    id TEXT PRIMARY KEY,
    document JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS matrix_features (
    matrix_id TEXT NOT NULL REFERENCES matrices(matrix_id) ON DELETE CASCADE,
    feature_id TEXT NOT NULL REFERENCES features(id) ON DELETE CASCADE,
    PRIMARY KEY (matrix_id, feature_id)
);

CREATE TABLE IF NOT EXISTS matrix_biosamples (
    matrix_id TEXT NOT NULL REFERENCES matrices(matrix_id) ON DELETE CASCADE,
    biosample_id TEXT NOT NULL REFERENCES biosamples(id) ON DELETE CASCADE,
    PRIMARY KEY (matrix_id, biosample_id)
);

CREATE TABLE IF NOT EXISTS expression_values (
    id TEXT PRIMARY KEY,
    matrix_id TEXT NOT NULL,
    feature_id TEXT NOT NULL,
    biosample_id TEXT NOT NULL,
    value DOUBLE PRECISION NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_ev_matrix_feature
    ON expression_values (matrix_id, feature_id);

CREATE INDEX IF NOT EXISTS ix_ev_matrix_biosample
    ON expression_values (matrix_id, biosample_id);

CREATE INDEX IF NOT EXISTS ix_ev_matrix_value
    ON expression_values (matrix_id, value);
