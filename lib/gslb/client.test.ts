/**
 * lib/gslb/client.test.ts
 *
 * Hermetic tests for the PowerGSLB adapter (client + transport). undici is
 * stubbed so no socket opens, and the URL guard is stubbed to a fixed
 * validated address - its own policy is covered by `lib/net` tests.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
const guardMock = vi.fn();

vi.mock("undici", () => {
  class FakeAgent {
    close(): Promise<void> {
      return Promise.resolve();
    }
  }
  return {
    Agent: FakeAgent,
    fetch: (...args: unknown[]) => fetchMock(...args) as unknown,
  };
});

vi.mock("./url-safety", () => ({
  checkGslbUrlSafe: (url: string) => guardMock(url) as unknown,
}));

const CONFIG = {
  baseUrl: "https://powergslb.example.test",
  username: "authadmin",
  password: "pa:ss word",
  backendSlug: "site-a",
};

function reply(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
  };
}

interface SentRequest {
  url: string;
  init: { method: string; headers: Record<string, string>; body: string; redirect: string };
}

function sent(index = 0): SentRequest {
  const call = fetchMock.mock.calls[index] as [string, SentRequest["init"]];
  return { url: call[0], init: call[1] };
}

async function newClient(timeoutMs?: number) {
  const { GslbClient } = await import("./client");
  return new GslbClient({ ...CONFIG, ...(timeoutMs !== undefined ? { timeoutMs } : {}) });
}

describe("GslbClient", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    guardMock.mockReset();
    guardMock.mockResolvedValue({ safe: true, addresses: ["203.0.113.10"] });
  });

  it("posts a form-encoded w2ui command with Basic Auth and parses the page", async () => {
    fetchMock.mockResolvedValue(
      reply(200, { status: "success", total: 7, records: [{ recid: 3, domain: "gslb.example." }] }),
    );
    const client = await newClient();

    const page = await client.getRecords("domains", { limit: 1 });

    expect(page).toEqual({ total: 7, records: [{ recid: 3, domain: "gslb.example." }] });
    const { url, init } = sent();
    expect(url).toBe("https://powergslb.example.test/admin/w2ui");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(init.headers["Authorization"]).toBe(
      `Basic ${Buffer.from("authadmin:pa:ss word").toString("base64")}`,
    );
    // PowerGSLB ignores `limit` unless `offset` is also present.
    expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({
      cmd: "get-records",
      data: "domains",
      limit: "1",
      offset: "0",
    });
  });

  it("encodes save-record fields as record[...] and delete ids as selected[...]", async () => {
    fetchMock.mockResolvedValue(reply(200, { status: "success" }));
    const client = await newClient();

    await client.saveRecord("records", 0, { name: "app", ttl: 60, content: "a&b=c" });
    await client.deleteRecords("records", [5, 9]);

    const save = new URLSearchParams(sent(0).init.body);
    expect(save.get("cmd")).toBe("save-record");
    expect(save.get("recid")).toBe("0");
    expect(save.get("record[name]")).toBe("app");
    expect(save.get("record[ttl]")).toBe("60");
    expect(save.get("record[content]")).toBe("a&b=c");

    const del = new URLSearchParams(sent(1).init.body);
    expect(del.get("cmd")).toBe("delete-records");
    expect(del.get("selected[0]")).toBe("5");
    expect(del.get("selected[1]")).toBe("9");
  });

  it("encodes search clauses as w2ui search[i][...] fields joined with AND", async () => {
    fetchMock.mockResolvedValue(reply(200, { status: "success", total: 0, records: [] }));
    const client = await newClient();

    await client.getRecords("views", {
      search: [{ field: "view", operator: "is", value: "authadmin:site-a" }],
    });

    expect(Object.fromEntries(new URLSearchParams(sent().init.body))).toEqual({
      cmd: "get-records",
      data: "views",
      "search[0][field]": "view",
      "search[0][type]": "text",
      "search[0][operator]": "is",
      "search[0][value]": "authadmin:site-a",
      searchLogic: "AND",
    });
  });

  it("skips the request when there is nothing to delete", async () => {
    const client = await newClient();
    await client.deleteRecords("records", []);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps 401 to kind unauthorized without leaking the password", async () => {
    fetchMock.mockResolvedValue(reply(401, "<html>401 Unauthorized</html>"));
    const client = await newClient();

    const err = await client.getRecord("records", 1).catch((e: unknown) => e);

    expect(err).toMatchObject({ name: "GslbError", kind: "unauthorized", status: 401 });
    expect(String((err as Error).message)).not.toContain("pa:ss word");
  });

  it("maps a non-JSON 200 to kind protocol", async () => {
    fetchMock.mockResolvedValue(reply(200, "<html>not the API</html>"));
    const client = await newClient();
    await expect(client.getRecords("views")).rejects.toMatchObject({ kind: "protocol" });
  });

  it("maps a 404 to kind protocol", async () => {
    fetchMock.mockResolvedValue(reply(404, "Not Found"));
    const client = await newClient();
    await expect(client.getRecords("views")).rejects.toMatchObject({ kind: "protocol" });
  });

  it("maps a status:error reply to kind upstream with the message", async () => {
    fetchMock.mockResolvedValue(reply(200, { status: "error", message: "record not changed" }));
    const client = await newClient();
    await expect(client.saveRecord("records", 0, { name: "x" })).rejects.toMatchObject({
      kind: "upstream",
      message: expect.stringContaining("record not changed") as unknown,
    });
  });

  it("treats an update that changes nothing as success once the row is confirmed", async () => {
    // A sibling row of the same rrset already picked up the new ttl/policy.
    fetchMock
      .mockResolvedValueOnce(reply(200, { status: "error", message: "record not changed" }))
      .mockResolvedValueOnce(reply(200, { status: "success", record: { recid: 4 } }));
    const client = await newClient();
    await expect(client.saveRecord("records", 4, { name: "x" })).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new URLSearchParams(sent(1).init.body).get("cmd")).toBe("get-record");
  });

  it("fails an update that changed nothing because the row was removed", async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, { status: "error", message: "record not changed" }))
      .mockResolvedValueOnce(
        reply(200, { status: "error", message: "get-record 'records' id 4 not found" }),
      );
    const client = await newClient();
    await expect(client.saveRecord("records", 4, { name: "x" })).rejects.toMatchObject({
      kind: "upstream",
      message: expect.stringContaining("was removed in PowerGSLB") as unknown,
    });
  });

  it("still throws other upstream errors on update", async () => {
    fetchMock.mockResolvedValue(reply(200, { status: "error", message: "internal error" }));
    const client = await newClient();
    await expect(client.saveRecord("records", 4, { name: "x" })).rejects.toMatchObject({
      kind: "upstream",
    });
  });

  it("maps a 5xx to kind upstream", async () => {
    fetchMock.mockResolvedValue(reply(503, "busy"));
    const client = await newClient();
    await expect(client.getRecords("records")).rejects.toMatchObject({ kind: "upstream" });
  });

  it("maps a success envelope without records to kind protocol", async () => {
    fetchMock.mockResolvedValue(reply(200, { status: "success" }));
    const client = await newClient();
    await expect(client.getRecords("records")).rejects.toMatchObject({ kind: "protocol" });
  });

  it("times out as kind unreachable", async () => {
    fetchMock.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () =>
            reject(new Error("This operation was aborted")),
          );
        }),
    );
    const client = await newClient(20);
    await expect(client.getRecords("domains")).rejects.toMatchObject({
      kind: "unreachable",
      message: expect.stringContaining("Timed out") as unknown,
    });
  });

  it("classifies a certificate error as kind tls", async () => {
    const cause = Object.assign(new Error("self-signed certificate"), {
      code: "DEPTH_ZERO_SELF_SIGNED_CERT",
    });
    fetchMock.mockRejectedValue(new TypeError("fetch failed", { cause }));
    const client = await newClient();
    await expect(client.getRecords("domains")).rejects.toMatchObject({ kind: "tls" });
  });

  it("classifies a refused connection as kind unreachable", async () => {
    const cause = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    fetchMock.mockRejectedValue(new TypeError("fetch failed", { cause }));
    const client = await newClient();
    await expect(client.getRecords("domains")).rejects.toMatchObject({ kind: "unreachable" });
  });

  it("refuses a URL the guard rejects without sending anything", async () => {
    guardMock.mockResolvedValue({ safe: false, reason: "Base URL resolves to a blocked address." });
    const client = await newClient();
    await expect(client.getRecords("domains")).rejects.toMatchObject({ kind: "unreachable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe("probe", () => {
    it("returns latency and per-table totals", async () => {
      const totals: Record<string, number> = { domains: 2, monitors: 5, views: 3, records: 11 };
      fetchMock.mockImplementation((_url: string, init: { body: string }) => {
        const table = new URLSearchParams(init.body).get("data") ?? "";
        return Promise.resolve(
          reply(200, { status: "success", total: totals[table], records: [] }),
        );
      });
      const client = await newClient();

      const result = await client.probe();

      expect(result).toMatchObject({
        ok: true,
        counts: { domains: 2, monitors: 5, views: 3, records: 11 },
      });
      expect(result.ok && result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it("returns the failure kind instead of throwing", async () => {
      fetchMock.mockResolvedValue(reply(401, ""));
      const client = await newClient();

      const result = await client.probe();

      expect(result).toMatchObject({ ok: false, kind: "unauthorized" });
      // Stops after the first failed round-trip.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
