import { describe, expect, it, vi } from "vitest";
import { ParameterStoreService } from "./parameterStore.js";

describe("ParameterStoreService", () => {
  it("loads all parameters and caches subsequent reads", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Parameter: { Value: "anthropic-key" } })
      .mockResolvedValueOnce({ Parameter: { Value: "client-id" } })
      .mockResolvedValueOnce({ Parameter: { Value: "client-secret" } });

    const service = new ParameterStoreService({ send } as any, "/gmail-translator");

    await expect(service.loadParams()).resolves.toEqual({
      anthropicApiKey: "anthropic-key",
      gmailOAuthClientId: "client-id",
      gmailOAuthClientSecret: "client-secret",
    });
    await service.loadParams();

    expect(send).toHaveBeenCalledTimes(3);
  });

  it("throws when a parameter is missing", async () => {
    const send = vi.fn().mockResolvedValue({ Parameter: {} });
    const service = new ParameterStoreService({ send } as any, "/gmail-translator");

    await expect(service.loadParams()).rejects.toThrow("Missing SSM parameter");
  });
});
