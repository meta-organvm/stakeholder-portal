import { loadEnvConfig } from "@next/env";
import * as fs from "fs";
import * as path from "path";

loadEnvConfig(process.cwd());

const REQUIRED_VARS = [
  "GROQ_API_KEY",
  "ADMIN_SESSION_SECRET",
  "DATABASE_URL",
  "EMBEDDING_API_KEY",
];

const OPTIONAL_VARS = [
  "SLACK_WEBHOOK_URL",
  "RESEND_API_KEY",
  "AUTH_GITHUB_ID",
  "AUTH_GITHUB_SECRET",
];

function validate() {
  console.log("🔍 Validating environment variables...");
  let missingRequired = 0;

  for (const v of REQUIRED_VARS) {
    if (!process.env[v]) {
      console.error(`❌ Missing REQUIRED variable: ${v}`);
      missingRequired++;
    } else {
      console.log(`✅ ${v} is set.`);
    }
  }

  for (const v of OPTIONAL_VARS) {
    if (!process.env[v]) {
      console.warn(`⚠️  Missing OPTIONAL variable: ${v}`);
    } else {
      console.log(`✅ ${v} is set (optional).`);
    }
  }

  if (missingRequired > 0) {
    console.error(`\n🚨 Validation FAILED: ${missingRequired} required variables missing.`);
    process.exit(1);
  } else {
    console.log("\n✨ Environment validation PASSED.");
  }
}

validate();
