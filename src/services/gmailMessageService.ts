import { gmail_v1 } from "googleapis";
import { extractBody, getHeader } from "../utils/emailParser.js";
import { buildRawReply } from "../utils/replyComposer.js";
import {
  IEmailMessage,
  IGmailService,
  IInboxMessageSummary,
  ISendReplyInput,
} from "../types.js";

export class GmailMessageService implements IGmailService {
  constructor(private readonly gmailClient: gmail_v1.Gmail) {}

  async getAuthenticatedEmail(): Promise<string> {
    const profile = await this.gmailClient.users.getProfile({ userId: "me" });
    const emailAddress = profile.data.emailAddress;

    if (!emailAddress) {
      throw new Error("Unable to determine authenticated Gmail address");
    }

    return emailAddress;
  }

  async listRecentInboxMessages(sinceEpochSeconds: number): Promise<IInboxMessageSummary[]> {
    const response = await this.gmailClient.users.messages.list({
      userId: "me",
      q: `is:inbox after:${sinceEpochSeconds} -from:me`,
      maxResults: 20,
    });

    return (response.data.messages ?? [])
      .filter((message): message is { id: string } => typeof message.id === "string")
      .map((message) => ({ id: message.id }));
  }

  async getMessage(id: string): Promise<IEmailMessage> {
    const response = await this.gmailClient.users.messages.get({
      userId: "me",
      id,
      format: "full",
    });

    const payload = response.data.payload;
    const headers = payload?.headers;
    const threadId = response.data.threadId;

    if (!threadId) {
      throw new Error(`Missing thread ID for message ${id}`);
    }

    return {
      id,
      threadId,
      subject: getHeader(headers, "Subject"),
      from: getHeader(headers, "From"),
      messageId: getHeader(headers, "Message-ID"),
      bodyText: extractBody(payload),
    };
  }

  async sendReply(input: ISendReplyInput): Promise<void> {
    await this.gmailClient.users.messages.send({
      userId: "me",
      requestBody: {
        raw: buildRawReply(input),
        threadId: input.threadId,
      },
    });
  }
}
