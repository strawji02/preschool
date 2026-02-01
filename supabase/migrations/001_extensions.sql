-- Enable required PostgreSQL extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Set trigram similarity threshold for fuzzy matching
SET pg_trgm.similarity_threshold = 0.3;
