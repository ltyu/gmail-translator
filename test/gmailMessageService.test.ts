import { describe, expect, it, vi } from "vitest";
import { GmailMessageService } from "../src/services/gmailMessageService.js";

function encode(value: string): string {
  return Buffer.from(value, "utf-8").toString("base64url");
}

describe("GmailMessageService", () => {
  it("reads the authenticated email address", async () => {
    const gmailClient = {
      users: {
        getProfile: vi.fn().mockResolvedValue({ data: { emailAddress: "me@example.com" } }),
        messages: {},
      },
    };

    const service = new GmailMessageService(gmailClient as any);
    await expect(service.getAuthenticatedEmail()).resolves.toBe("me@example.com");
  });

  it("lists recent inbox messages", async () => {
    const list = vi.fn().mockResolvedValue({
      data: { messages: [{ id: "1" }, { id: "2" }, {}] },
    });
    const service = new GmailMessageService({
      users: {
        getProfile: vi.fn(),
        messages: { list, get: vi.fn(), send: vi.fn() },
      },
    } as any);

    await expect(service.listRecentInboxMessages(123)).resolves.toEqual([{ id: "1" }, { id: "2" }]);
    expect(list).toHaveBeenCalledWith({
      userId: "me",
      q: "is:inbox after:123 -from:me",
      maxResults: 20,
    });
  });

  it("parses a full message and sends replies", async () => {
    const get = vi.fn().mockResolvedValue({
      data: {
        threadId: "thread-1",
        payload: {
          headers: [
            { name: "Subject", value: "Hello" },
            { name: "From", value: "sender@example.com" },
            { name: "Message-ID", value: "<id>" },
          ],
          parts: [{ mimeType: "text/plain", body: { data: encode("Body text") } }],
        },
      },
    });
    const send = vi.fn().mockResolvedValue({});
    const service = new GmailMessageService({
      users: {
        getProfile: vi.fn(),
        messages: { list: vi.fn(), get, send },
      },
    } as any);

    await expect(service.getMessage("message-1")).resolves.toEqual({
      id: "message-1",
      threadId: "thread-1",
      subject: "Hello",
      from: "sender@example.com",
      messageId: "<id>",
      bodyText: "Body text",
    });

    await service.sendReply({
      to: "me@example.com",
      subject: "Hello",
      messageId: "<id>",
      threadId: "thread-1",
      translation: "translated",
      originalText: "Body text",
    });

    expect(send).toHaveBeenCalledOnce();
    const payload = send.mock.calls[0][0].requestBody;
    expect(payload.threadId).toBe("thread-1");
    expect(Buffer.from(payload.raw, "base64url").toString("utf-8")).toContain("translated");
  });
});
