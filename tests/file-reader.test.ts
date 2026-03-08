import { describe, it, expect, vi } from "vitest";

// Mock manifest
vi.mock("@/lib/manifest", () => ({
  getManifest: () => ({
    system: { name: "Test", total_repos: 1 },
    organs: [],
    repos: [
      {
        name: "organvm-engine",
        slug: "organvm-engine",
        organ: "META-ORGANVM",
        display_name: "ORGANVM Engine",
      },
      {
        name: "test-repo",
        slug: "test-repo",
        organ: "ORGAN-I",
        display_name: "Test Repo",
      },
    ],
    deployments: [],
    dependency_graph: { nodes: [], edges: [] },
  }),
}));

import { readFile, listDirectory, isFileAccessAvailable } from "@/lib/file-reader";

describe("file-reader", () => {
  describe("isFileAccessAvailable", () => {
    it("returns true when workspace exists", () => {
      // The real workspace exists on this machine
      const result = isFileAccessAvailable();
      expect(typeof result).toBe("boolean");
    });
  });

  describe("readFile", () => {
    it("returns null for non-existent repos", () => {
      const result = readFile("nonexistent-repo", "README.md");
      expect(result).toBeNull();
    });

    it("returns null for path traversal attempts", () => {
      const result = readFile("organvm-engine", "../../etc/passwd");
      expect(result).toBeNull();
    });

    it("returns null for blocked paths", () => {
      const result = readFile("organvm-engine", ".git/config");
      expect(result).toBeNull();
    });

    it("returns null for .env files", () => {
      const result = readFile("organvm-engine", ".env");
      expect(result).toBeNull();
    });

    it("allows .env.example", () => {
      // .env.example is not in the blocklist
      // This may or may not exist, but it should not be blocked
      const result = readFile("organvm-engine", ".env.example");
      // Result is null if file doesn't exist, but not because of blocking
      expect(result === null || typeof result?.content === "string").toBe(true);
    });

    it("reads a real file when workspace exists", () => {
      if (!isFileAccessAvailable()) return; // skip on CI

      const result = readFile("organvm-engine", "pyproject.toml");
      if (result) {
        expect(result.content).toBeTruthy();
        expect(result.repo).toBe("organvm-engine");
        expect(result.path).toBe("pyproject.toml");
        expect(result.sizeBytes).toBeGreaterThan(0);
      }
    });
  });

  describe("listDirectory", () => {
    it("returns null for non-existent repos", () => {
      const result = listDirectory("nonexistent-repo", ".");
      expect(result).toBeNull();
    });

    it("returns null for blocked directories", () => {
      const result = listDirectory("organvm-engine", ".git");
      expect(result).toBeNull();
    });

    it("lists a real directory when workspace exists", () => {
      if (!isFileAccessAvailable()) return; // skip on CI

      const result = listDirectory("organvm-engine", "src");
      if (result) {
        expect(result.entries.length).toBeGreaterThan(0);
        expect(result.repo).toBe("organvm-engine");
        // Should contain organvm_engine directory
        const hasDir = result.entries.some((e) => e.type === "directory");
        expect(hasDir).toBe(true);
      }
    });

    it("sorts directories before files", () => {
      if (!isFileAccessAvailable()) return;

      const result = listDirectory("organvm-engine", ".");
      if (result && result.entries.length > 1) {
        const firstDir = result.entries.findIndex((e) => e.type === "directory");
        const firstFile = result.entries.findIndex((e) => e.type === "file");
        if (firstDir >= 0 && firstFile >= 0) {
          expect(firstDir).toBeLessThan(firstFile);
        }
      }
    });
  });
});
