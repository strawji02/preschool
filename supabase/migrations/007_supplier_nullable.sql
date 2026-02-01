-- supplier 컬럼 nullable로 변경 (3rd party 명세서 지원)
ALTER TABLE audit_sessions ALTER COLUMN supplier DROP NOT NULL;
