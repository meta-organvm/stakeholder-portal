import { loadEnvConfig } from "@next/env";
import { seedEscalationPolicies } from "../src/lib/alert-audit";

async function main() {
  loadEnvConfig(process.cwd());
  console.log("🌱 Seeding database...");
  try {
    await seedEscalationPolicies();
    console.log("✅ Escalation policies seeded successfully.");
  } catch (err) {
    console.error("❌ Seeding failed:", err);
    process.exit(1);
  }
}

main();
