import { db } from "../src/lib/db";
import { sql } from "drizzle-orm";

async function main() {
  try {
    console.log("Running ts_stat query...");
    const results = await db.execute(
        sql`SELECT word, ndoc, nentry FROM ts_stat('SELECT search_vector FROM document_chunks') ORDER BY nentry DESC LIMIT 15`
    );
    console.log("Success! Returned " + results.rows.length + " rows.");
    console.log(results.rows);
  } catch (e) {
    console.error("DB Error:", e);
  }
  process.exit(0);
}

main();
