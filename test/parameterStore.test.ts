import { describe, expect, it, vi } from "vitest";
import { ParameterStoreService } from "../src/services/parameterStore.js";

describe("ParameterStoreService", () => {
  it("loads all parameters and caches subsequent reads", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Parameter: { Value: "anthropic-key" } })
      .mockResolvedValueOnce({ Parameter: { Value: "client-id" } })
      .mockResolvedValueOnce({ Parameter: { Value: "client-secret" } })
      .mockResolvedValueOnce({ Parameter: { Value: "refresh-token" } });

    const service = new ParameterStoreService({ send } as any, "/gmail-translator");

    await expect(service.loadParams()).resolves.toEqual({
      anthropicApiKey: "anthropic-key",
      gmailOAuthClientId: "client-id",
      gmailOAuthClientSecret: "client-secret",
      legacyGmailRefreshToken: "refresh-token",
    });
    await service.loadParams();

    expect(send).toHaveBeenCalledTimes(4);
  });

  it("treats the legacy refresh token as optional", async () => {
    const parameterNotFoundError = new Error("missing");
    parameterNotFoundError.name = "ParameterNotFound";

    const send = vi
      .fn()
      .mockResolvedValueOnce({ Parameter: { Value: "anthropic-key" } })
      .mockResolvedValueOnce({ Parameter: { Value: "client-id" } })
      .mockResolvedValueOnce({ Parameter: { Value: "client-secret" } })
      .mockRejectedValueOnce(parameterNotFoundError);

    const service = new ParameterStoreService({ send } as any, "/gmail-translator");

    await expect(service.loadParams()).resolves.toEqual({
      anthropicApiKey: "anthropic-key",
      gmailOAuthClientId: "client-id",
      gmailOAuthClientSecret: "client-secret",
      legacyGmailRefreshToken: undefined,
    });
  });

  it("throws when a parameter is missing", async () => {
    const send = vi.fn().mockResolvedValue({ Parameter: {} });
    const service = new ParameterStoreService({ send } as any, "/gmail-translator");

    await expect(service.loadParams()).rejects.toThrow("Missing SSM parameter");
  });
});
