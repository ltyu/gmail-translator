import Anthropic from "@anthropic-ai/sdk";
import { TranslationService } from "../types.js";

const MODEL = "claude-haiku-4-5-20251001";
const MODEL_TOKENS = 8192;

export class AnthropicTranslationService implements TranslationService {
  constructor(private readonly anthropic: Anthropic) {}

  async translateText(text: string): Promise<string> {
    const response = await this.anthropic.messages.create({
      model: MODEL,
      max_tokens: MODEL_TOKENS,
      messages: [
        {
          role: "user",
          content: `Translate the following English email into Simplified Chinese. Preserve the original formatting (paragraphs, bullet points, etc). Only output the translation, nothing else.\n\n${text}`,
        },
      ],
    });

    const block = response.content[0];
    if (block?.type === "text") {
      return block.text;
    }

    throw new Error("Unexpected response from Claude");
  }
}
