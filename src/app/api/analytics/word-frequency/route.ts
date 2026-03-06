import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const repo = searchParams.get("repo");

    // We use ts_stat to natively aggregate word frequencies across the tsvector index
    let statQuery = sql`SELECT word, ndoc, nentry FROM ts_stat('SELECT search_vector FROM document_chunks')`;

    if (repo) {
       statQuery = sql`SELECT word, ndoc, nentry FROM ts_stat(${sql`'SELECT search_vector FROM document_chunks WHERE repo = ''' || ${repo} || ''''`})`;
    }

    const finalQuery = sql`${statQuery} ORDER BY nentry DESC LIMIT 50`;

    // Note: db.execute returns an array of objects representing the result rows
    const results = await db.execute(finalQuery);

    return NextResponse.json({
      success: true,
      data: results.rows || results,
    });
  } catch (error) {
    console.error("Failed to calculate word frequencies:", error);
    return NextResponse.json(
      { success: false, error: "Failed to calculate word frequencies" },
      { status: 500 }
    );
  }
}
