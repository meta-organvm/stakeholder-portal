import { beforeEach, describe, expect, it } from "vitest";
import {
  registerConnector,
  getConnector,
  listConnectors,
  unregisterConnector,
  resetConnectors,
} from "@/lib/connectors/types";
import type { ConnectorAdapter, ConnectorConfig, ConnectorState, IngestRecord } from "@/lib/connectors/types";

/** Minimal stub adapter for registry tests. */
function makeStubAdapter(id: string, name: string): ConnectorAdapter {
  return {
    id,
    name,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    configure(_config: ConnectorConfig) { /* no-op */ },
    async sync() { return [] as IngestRecord[]; },
    getState(): ConnectorState {
      return { status: "idle", last_run: null, records_ingested: 0, errors: 0, last_error: null };
    },
  };
}

beforeEach(() => {
  resetConnectors();
});

describe("Connector registry", () => {
  it("registers and retrieves a connector by id", () => {
    const adapter = makeStubAdapter("test-1", "Test One");
    registerConnector(adapter);
    const retrieved = getConnector("test-1");
    expect(retrieved).toBe(adapter);
  });

  it("returns undefined for unregistered connector id", () => {
    expect(getConnector("nonexistent")).toBeUndefined();
  });

  it("lists all registered connectors", () => {
    registerConnector(makeStubAdapter("a", "A"));
    registerConnector(makeStubAdapter("b", "B"));
    registerConnector(makeStubAdapter("c", "C"));

    const list = listConnectors();
    expect(list).toHaveLength(3);
    const ids = list.map((c) => c.id).sort();
    expect(ids).toEqual(["a", "b", "c"]);
  });

  it("unregisters a connector by id", () => {
    registerConnector(makeStubAdapter("removable", "Removable"));
    expect(getConnector("removable")).toBeDefined();

    unregisterConnector("removable");
    expect(getConnector("removable")).toBeUndefined();
  });

  it("unregisterConnector is a no-op for unknown ids", () => {
    expect(() => unregisterConnector("ghost")).not.toThrow();
  });

  it("resetConnectors clears all registrations", () => {
    registerConnector(makeStubAdapter("x", "X"));
    registerConnector(makeStubAdapter("y", "Y"));
    expect(listConnectors()).toHaveLength(2);

    resetConnectors();
    expect(listConnectors()).toHaveLength(0);
  });

  it("replaces an existing connector with the same id", () => {
    const first = makeStubAdapter("dup", "First");
    const second = makeStubAdapter("dup", "Second");

    registerConnector(first);
    expect(getConnector("dup")?.name).toBe("First");

    registerConnector(second);
    expect(getConnector("dup")?.name).toBe("Second");
    expect(listConnectors()).toHaveLength(1);
  });
});
