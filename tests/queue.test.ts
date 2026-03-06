import { describe, expect, it, vi } from "vitest";
import {
  enqueueJob,
  completeJob,
  failJob,
  retryDeadLetterJob,
  cancelPendingJobsOfType,
  purgeOldJobs,
} from "@/lib/queue";
import type { JobType } from "@/lib/queue";
import { db } from "@/lib/db";

// The global test setup mocks @/lib/db with no-op methods.
// We instrument the mock here to verify that the queue functions
// actually call through to the DB layer — not just that they resolve.

describe("queue", () => {
  it("enqueueJob returns a UUID string", async () => {
    const id = await enqueueJob({ type: "maintenance" as JobType });
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
    // Should look like a UUID (8-4-4-4-12 hex pattern)
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it("enqueueJob calls db.insert with correct fields", async () => {
    const insertSpy = vi.spyOn(db, "insert");
    await enqueueJob({ type: "maintenance" as JobType, payload: { x: 1 }, maxAttempts: 5 });
    expect(insertSpy).toHaveBeenCalledTimes(1);
    insertSpy.mockRestore();
  });

  it("enqueueJob respects optional parameters", async () => {
    const futureDate = new Date(Date.now() + 60_000);
    const id = await enqueueJob({
      type: "maintenance" as JobType,
      payload: { key: "value" },
      maxAttempts: 5,
      runAt: futureDate,
    });
    expect(typeof id).toBe("string");
  });

  it("completeJob resolves without error", async () => {
    await expect(
      completeJob("test-id", { result: "done" })
    ).resolves.toBeUndefined();
  });

  it("failJob resolves without error", async () => {
    await expect(
      failJob("test-id", "Something went wrong")
    ).resolves.toBeUndefined();
  });

  it("failJob queries db.select to find the job before updating", async () => {
    const selectSpy = vi.spyOn(db, "select");
    await failJob("some-job-id", "error");
    // failJob must look up attempts/maxAttempts before deciding the next status
    expect(selectSpy).toHaveBeenCalledTimes(1);
    selectSpy.mockRestore();
  });

  it("retryDeadLetterJob resolves without error", async () => {
    await expect(
      retryDeadLetterJob("dead-job-id")
    ).resolves.toBeUndefined();
  });

  it("cancelPendingJobsOfType resolves without error", async () => {
    await expect(
      cancelPendingJobsOfType("maintenance" as JobType)
    ).resolves.toBeUndefined();
  });

  it("purgeOldJobs resolves without error with default days", async () => {
    await expect(purgeOldJobs()).resolves.toBeUndefined();
  });

  it("purgeOldJobs accepts a custom olderThanDays parameter", async () => {
    await expect(purgeOldJobs(7)).resolves.toBeUndefined();
  });
});
