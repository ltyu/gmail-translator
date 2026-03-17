import { describe, expect, it, vi } from "vitest";
import { KmsGmailTokenEncryptionService } from "./kmsGmailTokenEncryptionService.js";

describe("KmsGmailTokenEncryptionService", () => {
  it("encrypts refresh tokens with a user-scoped encryption context", async () => {
    const send = vi.fn().mockResolvedValue({
      CiphertextBlob: Buffer.from("encrypted-token", "utf8"),
    });
    const service = new KmsGmailTokenEncryptionService({ send } as any, "alias/gmail-refresh-token");

    const ciphertext = await service.encryptRefreshToken("refresh-token", { userId: "user-123" });

    expect(ciphertext).toBe(Buffer.from("encrypted-token", "utf8").toString("base64"));

    const command = send.mock.calls[0][0];
    expect(Buffer.from(command.input.Plaintext).toString("utf8")).toBe("refresh-token");
    expect(command.input.KeyId).toBe("alias/gmail-refresh-token");
    expect(command.input.EncryptionContext).toEqual({
      purpose: "gmail-refresh-token",
      userId: "user-123",
      connectionId: "primary",
    });
  });

  it("decrypts refresh tokens with the same encryption context", async () => {
    const send = vi.fn().mockResolvedValue({
      Plaintext: Buffer.from("refresh-token", "utf8"),
    });
    const service = new KmsGmailTokenEncryptionService({ send } as any, "alias/gmail-refresh-token");

    const refreshToken = await service.decryptRefreshToken(
      Buffer.from("encrypted-token", "utf8").toString("base64"),
      { userId: "user-123", connectionId: "primary" },
    );

    expect(refreshToken).toBe("refresh-token");

    const command = send.mock.calls[0][0];
    expect(Buffer.from(command.input.CiphertextBlob).toString("utf8")).toBe("encrypted-token");
    expect(command.input.EncryptionContext).toEqual({
      purpose: "gmail-refresh-token",
      userId: "user-123",
      connectionId: "primary",
    });
  });
});
