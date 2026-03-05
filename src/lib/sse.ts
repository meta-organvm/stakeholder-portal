export interface ParsedSseChunk {
  done: boolean;
  payloads: string[];
  remainder: string;
}

/** Parse a raw SSE text chunk while preserving incomplete trailing lines. */
export function parseSseChunk(previousRemainder: string, chunk: string): ParsedSseChunk {
  const combined = previousRemainder + chunk;
  const lines = combined.split("\n");
  const remainder = lines.pop() ?? "";

  const payloads: string[] = [];
  let done = false;

  for (const line of lines) {
    if (!line.startsWith("data: ")) {
      continue;
    }

    const data = line.slice(6);
    if (data === "[DONE]") {
      done = true;
      break;
    }

    payloads.push(data);
  }

  return { done, payloads, remainder };
}
