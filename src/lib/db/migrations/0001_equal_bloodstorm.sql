CREATE TABLE "document_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"repo" text NOT NULL,
	"organ" text NOT NULL,
	"path" text NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "embedding_idx" ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "chunk_repo_path_idx" ON "document_chunks" USING btree ("repo","path");