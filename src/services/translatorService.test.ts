import { describe, expect, it, vi } from "vitest";
import { AnthropicTranslationService } from "./translatorService.js";

describe("AnthropicTranslationService", () => {
  it("returns translated text from the first content block", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "translated text" }],
    });
    const service = new AnthropicTranslationService({ messages: { create } } as any);

    await expect(service.translateText("hello")).resolves.toBe("translated text");
    expect(create).toHaveBeenCalledOnce();
  });

  it("throws on unexpected response blocks", async () => {
    const service = new AnthropicTranslationService({
      messages: { create: vi.fn().mockResolvedValue({ content: [{ type: "tool_use" }] }) },
    } as any);

    await expect(service.translateText("hello")).rejects.toThrow("Unexpected response from Claude");
  });
});
