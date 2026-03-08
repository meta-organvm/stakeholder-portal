/**
 * Shared chunking + embedding logic.
 *
 * Used by both the batch ingestion worker (`ingest-worker.ts`) and the
 * incremental connector pipeline to write into `document_chunks`.
 */

import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { eq, and } from "drizzle-orm";
import { db } from "../db";
import { documentChunks } from "../db/schema";
import { connectorCursors } from "../db/schema";
import { splitFile } from "./code-splitter";

// ---------------------------------------------------------------------------
// Embedding API call (HuggingFace or OpenAI-compatible)
// ---------------------------------------------------------------------------

export async function fetchEmbedding(text: string): Promise<number[]> {
  const apiUrl = process.env.EMBEDDING_API_URL || "https://api.openai.com/v1/embeddings";
  const apiKey = process.env.EMBEDDING_API_KEY; // allow-secret: env lookup only
  const model = process.env.EMBEDDING_MODEL || "text-embedding-3-small";
  const isHuggingFace = apiUrl.includes("huggingface.co") || apiUrl.includes("hf-inference");

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: isHuggingFace
      ? JSON.stringify({ inputs: text })
      : JSON.stringify({ input: text, model }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Embedding API failed: ${response.status} ${err}`);
  }

  const data = await response.json();

  if (isHuggingFace) {
    return Array.isArray(data[0]) ? data[0] : data;
  }

  if (!data?.data?.[0]?.embedding) {
    throw new Error("Invalid format returned by embedding API.");
  }
  return data.data[0].embedding;
}

// ---------------------------------------------------------------------------
// Shared chunking + embedding
// ---------------------------------------------------------------------------

export interface EmbedChunksOptions {
  repo: string;
  organ: string;
  filePath: string;    // relative path within repo
  content: string;
  fileMtime?: Date;
  commitSha?: string;
  contentClass?: string;
}

export interface EmbedChunksResult {
  inserted: number;
  errors: number;
}

const fallbackSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1000,
  chunkOverlap: 200,
});

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".py"]);

function isCodePath(filePath: string): boolean {
  const ext = "." + (filePath.split(".").pop()?.toLowerCase() || "");
  return CODE_EXTENSIONS.has(ext);
}

export async function embedChunks(opts: EmbedChunksOptions): Promise<EmbedChunksResult> {
  const { repo, organ, filePath, content, fileMtime, commitSha, contentClass } = opts;
  let inserted = 0;
  let errors = 0;

  if (!content.trim()) return { inserted, errors };

  // Delete stale chunks for this file before re-embedding
  await db
    .delete(documentChunks)
    .where(and(eq(documentChunks.repo, repo), eq(documentChunks.path, filePath)));

  // Use code-aware splitting for code files, fallback for others
  let textChunks: string[];
  if (isCodePath(filePath)) {
    const codeChunks = await splitFile(content, filePath, repo);
    textChunks = codeChunks.map((c) => c.content);
  } else {
    const docs = await fallbackSplitter.createDocuments([content]);
    textChunks = docs.map((d) => d.pageContent);
  }

  for (let i = 0; i < textChunks.length; i++) {
    const textChunk = textChunks[i];
    if (textChunk.length < 50) continue;

    try {
      const embedding = await fetchEmbedding(textChunk);
      const chunkId = `${repo}:${filePath}:${i}`;

      await db
        .insert(documentChunks)
        .values({
          id: chunkId,
          repo,
          organ,
          path: filePath,
          content: textChunk,
          contentClass: contentClass ?? null,
          embedding,
          fileMtime: fileMtime ?? null,
          commitSha: commitSha ?? null,
          ingestedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: documentChunks.id,
          set: {
            content: textChunk,
            contentClass: contentClass ?? null,
            embedding,
            fileMtime: fileMtime ?? null,
            commitSha: commitSha ?? null,
            ingestedAt: new Date(),
          },
        });

      inserted++;
    } catch (err: unknown) {
      const msg = (err as Error).message || String(err);
      console.error(`[Error] Failed to embed chunk ${filePath}#${i}: ${msg}`);
      errors++;
    }
  }

  return { inserted, errors };
}

// ---------------------------------------------------------------------------
// Per-repo cursor tracking (reuses connector_cursors table)
// ---------------------------------------------------------------------------

function cursorId(repo: string): string {
  return `vector:${repo}`;
}

export async function getRepoCursor(repo: string): Promise<string | null> {
  const rows = await db
    .select({ cursor: connectorCursors.cursor })
    .from(connectorCursors)
    .where(eq(connectorCursors.connectorId, cursorId(repo)))
    .limit(1);
  return rows[0]?.cursor ?? null;
}

export async function setRepoCursor(repo: string, commitSha: string): Promise<void> {
  await db
    .insert(connectorCursors)
    .values({
      connectorId: cursorId(repo),
      cursor: commitSha,
      lastSyncAt: new Date(),
      totalSynced: 0,
    })
    .onConflictDoUpdate({
      target: connectorCursors.connectorId,
      set: {
        cursor: commitSha,
        lastSyncAt: new Date(),
        updatedAt: new Date(),
      },
    });
}
