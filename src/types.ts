export interface AppConfig {
  dynamoDbTable: string;
  ssmPrefix: string;
}

export interface AppSecrets {
  anthropicApiKey: string;
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}

export interface InboxMessageSummary {
  id: string;
}

export interface EmailMessage {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  messageId: string;
  bodyText: string;
}

export interface SendReplyInput {
  to: string;
  subject: string;
  messageId: string;
  threadId: string;
  translation: string;
  originalText: string;
}

export interface GmailService {
  getAuthenticatedEmail(): Promise<string>;
  listRecentInboxMessages(sinceEpochSeconds: number): Promise<InboxMessageSummary[]>;
  getMessage(id: string): Promise<EmailMessage>;
  sendReply(input: SendReplyInput): Promise<void>;
}

export interface TranslationService {
  translateText(text: string): Promise<string>;
}

export interface ProcessedEmailService {
  isProcessed(emailId: string): Promise<boolean>;
  markProcessed(emailId: string): Promise<void>;
}
