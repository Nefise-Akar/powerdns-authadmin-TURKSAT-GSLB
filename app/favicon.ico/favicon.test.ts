import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GET, ICON_PNG_BASE64 } from "./route";

/**
 * `app/icon.png` is the icon Next injects into <head>; `ICON_PNG_BASE64` is the
 * copy this route serves at the legacy `/favicon.ico` path. The copy exists
 * because the standalone production image ships no source `app/` directory to
 * read from - so the only thing keeping them honest is this test.
 */
describe("/favicon.ico", () => {
  it("serves bytes identical to app/icon.png", async () => {
    const onDisk = await readFile(path.join(process.cwd(), "app", "icon.png"));
    expect(Buffer.from(ICON_PNG_BASE64, "base64").equals(onDisk)).toBe(true);
  });

  it("responds 200 with a non-empty PNG body", async () => {
    const res = GET();
    // Specifically NOT 204: a null-body status here broke Next's prerender
    // cache and then threw from the Response constructor on replay.
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.subarray(1, 4).toString("ascii")).toBe("PNG");
  });
});
