import * as fs from "fs";
import * as path from "path";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { documentChunks } from "../src/lib/db/schema";
import { sql } from "drizzle-orm";
// Assume dotenv is available via tsx loading or explicit import
import "dotenv/config";

const MANIFEST_PATH = path.join(process.cwd(), "src/data/manifest.json");

// Define basic environment variables expected
const EMBEDDING_API_URL = process.env.EMBEDDING_API_URL || "https://api.openai.com/v1/embeddings";
const EMBEDDING_API_KEY = process.env.EMBEDDING_API_KEY;
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("FATAL: DATABASE_URL is not set.");
  process.exit(1);
}
if (!EMBEDDING_API_KEY) {
  console.warn("WARNING: EMBEDDING_API_KEY is not set. Ingestion may fail if the provider requires auth.");
}

// ----------------------------------------------------------------------------
// DB Setup
// ----------------------------------------------------------------------------
const pool = new Pool({ connectionString: DATABASE_URL });
const db = drizzle(pool);

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

interface ManifestRepo {
  name: string;
  organ_dir?: string;
  organ_key?: string;
}

interface Manifest {
  repos: ManifestRepo[];
}

// ----------------------------------------------------------------------------
// Chunking Logic
// ----------------------------------------------------------------------------

/**
 * Super naive markdown chunker. Splits by paragraphs/headers and groups them
 * up to roughly ~500 words per chunk.
 */
function chunkText(text: string, maxWords = 400): string[] {
  const paragraphs = text.split(/\n\s*\n/);
  const chunks: string[] = [];
  let currentChunk: string[] = [];
  let currentWordCount = 0;

  for (const p of paragraphs) {
    const wordCount = p.split(/\s+/).length;
    if (currentWordCount + wordCount > maxWords && currentChunk.length > 0) {
      chunks.push(currentChunk.join("\n\n"));
      currentChunk = [p];
      currentWordCount = wordCount;
    } else {
      currentChunk.push(p);
      currentWordCount += wordCount;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join("\n\n"));
  }

  return chunks;
}

// ----------------------------------------------------------------------------
// Embedding API
// ----------------------------------------------------------------------------

async function fetchEmbedding(text: string): Promise<number[]> {
  const response = await fetch(EMBEDDING_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(EMBEDDING_API_KEY ? { Authorization: `Bearer ${EMBEDDING_API_KEY}` } : {}),
    },
    body: JSON.stringify({
      input: text,
      model: EMBEDDING_MODEL,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Embedding API failed: ${response.status} ${err}`);
  }

  const data = await response.json();
  if (!data?.data?.[0]?.embedding) {
    throw new Error("Invalid format returned by embedding API.");
  }
  return data.data[0].embedding;
}

// ----------------------------------------------------------------------------
// File Discovery
// ----------------------------------------------------------------------------

/** Recursively find relevant files starting from dir */
function walkRepo(dir: string): string[] {
  let results: string[] = [];
  try {
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const fullPath = path.resolve(dir, file);
      const stat = fs.statSync(fullPath);

      if (stat && stat.isDirectory()) {
        // Skip node_modules, .git, etc
        if (!file.startsWith(".") && file !== "node_modules" && file !== "dist") {
          results = results.concat(walkRepo(fullPath));
        }
      } else {
        // We only care about md, key python scripts, or conductor
        const isValidFile =
          file.endsWith(".md") ||
          (dir.includes("conductor") && !file.endsWith(".json")) ||
          (dir.includes("research") && file.endsWith(".md")) ||
          (dir.includes("intake") && file.endsWith(".md")) ||
          (dir.includes("scripts") && file.endsWith(".py"));

        if (isValidFile) {
          results.push(fullPath);
        }
      }
    }
  } catch {
    // Dir doesn't exist or is unreadable
  }
  return results;
}

// ----------------------------------------------------------------------------
// Main Ingestion
// ----------------------------------------------------------------------------

async function run() {
  console.log("Starting corpus ingestion...");

  // 1. Ensure extension exists
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);

  // 2. Read manifest
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`Manifest not found at ${MANIFEST_PATH}`);
    process.exit(1);
  }
  const manifestData: Manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));

  let totalChunksInserted = 0;

  for (const repo of manifestData.repos) {
    if (!repo.organ_dir) continue;

    // Organ_dir points to absolute path in user's workspace usually
    const repoPath = repo.organ_dir;

    if (!fs.existsSync(repoPath)) {
      console.warn(`[Skip] Directory not found for ${repo.name}: ${repoPath}`);
      continue;
    }

    console.log(`[Ingest] Processing ${repo.name} at ${repoPath}`);
    const files = walkRepo(repoPath);

    for (const f of files) {
      const relativePath = path.relative(repoPath, f);
      const content = fs.readFileSync(f, "utf-8");
      if (!content.trim()) continue;

      const chunks = chunkText(content);
      for (let i = 0; i < chunks.length; i++) {
        const text = chunks[i];
        if (text.length < 50) continue; // Ignore tiny fragments

        try {
          const embedding = await fetchEmbedding(text);
          const chunkId = `${repo.name}:${relativePath}:${i}`;

          await db
            .insert(documentChunks)
            .values({
              id: chunkId,
              repo: repo.name,
              organ: repo.organ_key || "unknown",
              path: relativePath,
              content: text,
              embedding: embedding,
            })
            .onConflictDoUpdate({
              target: documentChunks.id,
              set: {
                content: text,
                embedding: embedding,
              },
            });

          totalChunksInserted++;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[Error] Failed to ingest chunk in ${relativePath}: ${msg}`);
        }
      }
    }
  }

  console.log(`\nIngestion complete! Inserted/Updated ${totalChunksInserted} chunks.`);
  await pool.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
