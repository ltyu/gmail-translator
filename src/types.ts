export interface AppConfig {
  processedEmailTable: string;
  appSecretsPrefix: string;
  gmailConnectionsTable: string;
  gmailConnectionsStatusIndex: string;
  gmailTokenKmsKeyId: string;
}

export interface AppSecrets {
  anthropicApiKey: string;
  gmailOAuthClientId: string;
  gmailOAuthClientSecret: string;
}

export interface GmailOAuthAppCredentials {
  clientId: string;
  clientSecret: string;
}

export const GMAIL_CONNECTION_STATUSES = ["active", "revoked", "error"] as const;

export type GmailConnectionStatus = (typeof GMAIL_CONNECTION_STATUSES)[number];

export interface GmailConnectionTokenError {
  code: string;
  message?: string;
  occurredAt: string;
}

export interface GmailConnectionRecord {
  userId: string;
  connectionId: string;
  status: GmailConnectionStatus;
  gmailAddress?: string;
  providerSubject?: string;
  scopes: string[];
  encryptedRefreshToken?: string;
  tokenCiphertextVersion?: string;
  tokenKmsKeyId?: string;
  tokenUpdatedAt?: string;
  lastAuthenticatedAt?: string;
  tokenError?: GmailConnectionTokenError;
  revokedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertGmailConnectionInput {
  userId: string;
  connectionId?: string;
  status?: GmailConnectionStatus;
  gmailAddress?: string;
  providerSubject?: string;
  scopes?: string[];
  encryptedRefreshToken: string;
  tokenCiphertextVersion: string;
  tokenKmsKeyId: string;
  tokenUpdatedAt: string;
  lastAuthenticatedAt?: string;
}

export interface UpdateGmailConnectionStatusInput {
  userId: string;
  connectionId?: string;
  status: GmailConnectionStatus;
  changedAt?: string;
  revokedAt?: string;
}

export interface RecordGmailConnectionTokenErrorInput {
  userId: string;
  connectionId?: string;
  status?: Extract<GmailConnectionStatus, "error" | "revoked">;
  error: GmailConnectionTokenError;
}

export interface ClearGmailConnectionTokenDataInput {
  userId: string;
  connectionId?: string;
  status?: Extract<GmailConnectionStatus, "revoked" | "error">;
  changedAt?: string;
  revokedAt?: string;
}

export interface ListGmailConnectionsInput {
  limit?: number;
}

export interface GmailConnectionRepository {
  upsert(input: UpsertGmailConnectionInput): Promise<GmailConnectionRecord>;
  loadByUserId(userId: string): Promise<GmailConnectionRecord | null>;
  listActiveConnections(input?: ListGmailConnectionsInput): Promise<GmailConnectionRecord[]>;
  updateStatus(input: UpdateGmailConnectionStatusInput): Promise<void>;
  recordTokenError(input: RecordGmailConnectionTokenErrorInput): Promise<void>;
  clearTokenData(input: ClearGmailConnectionTokenDataInput): Promise<void>;
  remove(userId: string, connectionId?: string): Promise<void>;
}

export interface GmailTokenEncryptionContext {
  userId: string;
  connectionId?: string;
}

export interface GmailTokenEncryptionService {
  encryptRefreshToken(token: string, context: GmailTokenEncryptionContext): Promise<string>;
  decryptRefreshToken(ciphertext: string, context: GmailTokenEncryptionContext): Promise<string>;
}

export interface AuthenticatedAppUser {
  userId: string;
}

export interface AuthenticatedAppUserProvider<TRequestContext = unknown> {
  getAuthenticatedUser(context: TRequestContext): Promise<AuthenticatedAppUser | null>;
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
