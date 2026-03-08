ALTER TABLE "document_chunks" ADD COLUMN "content_class" text;

-- Index for filtering by content class during retrieval
CREATE INDEX "chunk_content_class_idx" ON "document_chunks" ("content_class") WHERE "content_class" IS NOT NULL;
