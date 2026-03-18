import { ISendReplyInput } from "../types.js";

export function buildReplyBody(translation: string, originalText: string): string {
  return [
    "⬇ 以下为自动翻译 / Auto-translated",
    "----------------------------------------",
    "",
    translation,
    "",
    "----------------------------------------",
    "",
    originalText,
  ].join("\n");
}

export function buildRawReply(input: ISendReplyInput): string {
  const replyHeaders = [
    `To: ${input.to}`,
    `In-Reply-To: ${input.messageId}`,
    `References: ${input.messageId}`,
    `Subject: Re: ${input.subject}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    buildReplyBody(input.translation, input.originalText),
  ].join("\r\n");

  return Buffer.from(replyHeaders).toString("base64url");
}
