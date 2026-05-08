-- Phase 0.1 — pluggable artifact storage seam.
-- Records R2 object keys per artifact kind when the runner uses an R2-backed
-- ArtifactStore. NULL until Phase 1 flips the runner to upload-on-write.

ALTER TABLE report_artifacts
    ADD COLUMN IF NOT EXISTS r2_keys jsonb;
