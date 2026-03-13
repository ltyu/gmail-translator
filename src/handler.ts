import { ScheduledEvent } from "aws-lambda";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import Anthropic from "@anthropic-ai/sdk";
import { google } from "googleapis";
import { convert } from "html-to-text";

const ssm = new SSMClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.DYNAMODB_TABLE!;
const SSM_PREFIX = process.env.SSM_PREFIX!;
const MODEL = "claude-haiku-4-5-20251001";
const MODEL_TOKENS = 8192;

// Cache SSM params across warm invocations
let cachedParams: {
  anthropicApiKey: string;
  refreshToken: string;
  clientId: string;
  clientSecret: string;
} | null = null;

async function getSSMParam(name: string): Promise<string> {
  const res = await ssm.send(
    new GetParameterCommand({ Name: `${SSM_PREFIX}/${name}` }),
  );
  return res.Parameter!.Value!;
}

async function loadParams() {
  if (cachedParams) return cachedParams;
  const [anthropicApiKey, refreshToken, clientId, clientSecret] =
    await Promise.all([
      getSSMParam("anthropic-api-key"),
      getSSMParam("gmail-refresh-token"),
      getSSMParam("gmail-client-id"),
      getSSMParam("gmail-client-secret"),
    ]);
  cachedParams = { anthropicApiKey, refreshToken, clientId, clientSecret };
  return cachedParams;
}

function buildGmailClient(params: NonNullable<typeof cachedParams>) {
  const oauth2Client = new google.auth.OAuth2(
    params.clientId,
    params.clientSecret,
  );
  oauth2Client.setCredentials({ refresh_token: params.refreshToken });
  return google.gmail({ version: "v1", auth: oauth2Client });
}

function extractBody(payload: any): string {
  // Try to find plain text part first
  const textPart = findPart(payload, "text/plain");
  if (textPart?.body?.data) {
    return Buffer.from(textPart.body.data, "base64url").toString("utf-8");
  }

  // Fall back to HTML part
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

function findPart(payload: any, mimeType: string): any {
  if (payload.mimeType === mimeType && payload.body?.data) {
    return payload;
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const found = findPart(part, mimeType);
      if (found) return found;
    }
  }
  return null;
}

function getHeader(headers: any[], name: string): string {
  return (
    headers?.find((h: any) => h.name.toLowerCase() === name.toLowerCase())
      ?.value ?? ""
  );
}

async function translateText(
  anthropic: Anthropic,
  text: string,
): Promise<string> {
  const response = await anthropic.messages.create({
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
  if (block.type === "text") {
    return block.text;
  }
  throw new Error("Unexpected response from Claude");
}

async function isProcessed(emailId: string): Promise<boolean> {
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { email_id: emailId } }),
  );
  return !!res.Item;
}

async function markProcessed(emailId: string): Promise<void> {
  const ttl = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60; // 30 days
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { email_id: emailId, ttl, processed_at: new Date().toISOString() },
    }),
  );
}

export async function handler(_event: ScheduledEvent): Promise<void> {
  const params = await loadParams();
  const gmail = buildGmailClient(params);
  const anthropic = new Anthropic({ apiKey: params.anthropicApiKey });

  // Get the authenticated user's email address
  const profile = await gmail.users.getProfile({ userId: "me" });
  const myEmail = profile.data.emailAddress!;

  // List recent inbox messages (last 10 min window to cover 5-min cron overlap)
  const tenMinAgo = Math.floor((Date.now() - 10 * 60 * 1000) / 1000);
  const listRes = await gmail.users.messages.list({
    userId: "me",
    q: `is:inbox after:${tenMinAgo} -from:me`,
    maxResults: 20,
  });

  const messages = listRes.data.messages ?? [];
  console.log(`Found ${messages.length} recent messages`);

  for (const msg of messages) {
    const emailId = msg.id!;

    if (await isProcessed(emailId)) {
      console.log(`Skipping already processed: ${emailId}`);
      continue;
    }

    // Fetch full message
    const fullMsg = await gmail.users.messages.get({
      userId: "me",
      id: emailId,
      format: "full",
    });

    console.log("fullMsg", fullMsg);

    const headers = fullMsg.data.payload?.headers ?? [];
    const subject = getHeader(headers, "Subject");
    const from = getHeader(headers, "From");
    const threadId = fullMsg.data.threadId!;
    const messageId = getHeader(headers, "Message-ID");

    console.log(`Processing: "${subject}" from ${from}`);

    // Extract body text
    const bodyText = extractBody(fullMsg.data.payload);
    if (!bodyText.trim()) {
      console.log(`Empty body, skipping: ${emailId}`);
      await markProcessed(emailId);
      continue;
    }

    // Translate
    const translation = await translateText(anthropic, bodyText);

    // Build reply
    const replyBody = [
      "⬇ 以下为自动翻译 / Auto-translated",
      "----------------------------------------",
      "",
      translation,
      "",
      "----------------------------------------",
      "",
      bodyText,
    ].join("\n");

    // Encode as RFC 2822 message
    const replyHeaders = [
      `To: ${myEmail}`,
      `In-Reply-To: ${messageId}`,
      `References: ${messageId}`,
      `Subject: Re: ${subject}`,
      `Content-Type: text/plain; charset=UTF-8`,
      "",
      replyBody,
    ].join("\r\n");

    const encodedMessage = Buffer.from(replyHeaders).toString("base64url");

    await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: encodedMessage,
        threadId,
      },
    });

    console.log(`Replied with translation for: "${subject}"`);
    await markProcessed(emailId);
  }

  console.log("Done");
}
