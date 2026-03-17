import { describe, expect, it } from "vitest";
import { buildRawReply, buildReplyBody } from "./replyComposer.js";

describe("replyComposer", () => {
  it("builds the visible reply body", () => {
    expect(buildReplyBody("translated", "original")).toContain("translated");
    expect(buildReplyBody("translated", "original")).toContain("original");
  });

  it("encodes a reply email with expected headers", () => {
    const raw = buildRawReply({
      to: "me@example.com",
      subject: "Hello",
      messageId: "<message-id>",
      threadId: "thread-1",
      translation: "translated",
      originalText: "original",
    });

    const decoded = Buffer.from(raw, "base64url").toString("utf-8");

    expect(decoded).toContain("To: me@example.com");
    expect(decoded).toContain("In-Reply-To: <message-id>");
    expect(decoded).toContain("References: <message-id>");
    expect(decoded).toContain("Subject: Re: Hello");
    expect(decoded).toContain("translated");
    expect(decoded).toContain("original");
  });
});
