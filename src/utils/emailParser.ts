import { convert } from "html-to-text";

export function findPart(payload: any, mimeType: string): any {
  if (!payload) {
    return null;
  }

  if (payload.mimeType === mimeType && payload.body?.data) {
    return payload;
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      const found = findPart(part, mimeType);
      if (found) {
        return found;
      }
    }
  }

  return null;
}

export function extractBody(payload: any): string {
  const textPart = findPart(payload, "text/plain");
  if (textPart?.body?.data) {
    return Buffer.from(textPart.body.data, "base64url").toString("utf-8");
  }

  const htmlPart = findPart(payload, "text/html");
  if (htmlPart?.body?.data) {
    const html = Buffer.from(htmlPart.body.data, "base64url").toString("utf-8");
    return convert(html, {
      wordwrap: false,
      selectors: [
        { selector: "img", format: "skip" },
        { selector: "a", options: { ignoreHref: true } },
      ],
    });
  }

  return "";
}

export function getHeader(
  headers: Array<{ name?: string | null; value?: string | null }> | undefined,
  name: string,
): string {
  return (
    headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value ?? ""
  );
}
