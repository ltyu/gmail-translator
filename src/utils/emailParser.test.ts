import { describe, expect, it } from "vitest";
import { extractBody, getHeader } from "./emailParser.js";

function encode(value: string): string {
  return Buffer.from(value, "utf-8").toString("base64url");
}

describe("emailParser", () => {
  it("prefers text/plain over text/html", () => {
    const body = extractBody({
      parts: [
        { mimeType: "text/html", body: { data: encode("<p>HTML body</p>") } },
        { mimeType: "text/plain", body: { data: encode("Plain body") } },
      ],
    });

    expect(body).toBe("Plain body");
  });

  it("falls back to html when plain text is missing", () => {
    const body = extractBody({
      parts: [{ mimeType: "text/html", body: { data: encode("<p>Hello <strong>world</strong></p>") } }],
    });

    expect(body).toContain("Hello world");
  });

  it("finds nested parts and returns empty string when missing", () => {
    const nestedBody = extractBody({
      parts: [
        {
          parts: [{ mimeType: "text/plain", body: { data: encode("Nested text") } }],
        },
      ],
    });

    expect(nestedBody).toBe("Nested text");
    expect(extractBody({ parts: [] })).toBe("");
  });

  it("gets headers case-insensitively", () => {
    expect(
      getHeader([{ name: "SuBjEcT", value: "Hello" }], "subject"),
    ).toBe("Hello");
  });
});
