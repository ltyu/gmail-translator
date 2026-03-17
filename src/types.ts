export interface AppConfig {
  processedEmailTable: string;
  appSecretsPrefix: string;
  gmailConnectionsTable?: string;
  gmailConnectionsStatusIndex?: string;
  gmailTokenKmsKeyId?: string;
  googleOAuthCallbackUrl?: string;
}

export interface AppSecrets {
  anthropicApiKey: string;
  gmailOAuthClientId: string;
  gmailOAuthClientSecret: string;
  legacyGmailRefreshToken?: string;
}

export interface GmailOAuthAppCredentials {
  clientId: string;
  clientSecret: string;
}

export const GMAIL_CONNECTION_STATUSES = ["active", "revoked", "error"] as const;

export type GmailConnectionStatus = (typeof GMAIL_CONNECTION_STATUSES)[number];

export const PRIMARY_GMAIL_CONNECTION_ID = "primary" as const;

export interface GmailConnectionRecord {
  // Internal app user that owns this Gmail connection.
  userId: string;
  // Fixed primary connection id for the MVP.
  connectionId: typeof PRIMARY_GMAIL_CONNECTION_ID;
  // Current lifecycle state for worker eligibility.
  status: GmailConnectionStatus;
  // Stable Google account subject from OAuth identity data.
  googleSub: string;
  // Human-readable Gmail address for UI and debugging.
  gmailAddress?: string;
  // KMS-encrypted Gmail refresh token used by backend workers.
  encryptedRefreshToken?: string;
  // When the connection record was first created.
  createdAt: string;
  // When the connection record last changed.
  updatedAt: string;
}

export interface UpsertPrimaryGmailConnectionInput {
  // Internal app user that owns this Gmail connection.
  userId: string;
  // Stable Google account subject from OAuth identity data.
  googleSub: string;
  // Human-readable Gmail address for UI and debugging.
  gmailAddress?: string;
  // KMS-encrypted Gmail refresh token to persist.
  encryptedRefreshToken: string;
  // Connection state to write; defaults to active.
  status?: GmailConnectionStatus;
  // Timestamp to use for createdAt/updatedAt bookkeeping.
  occurredAt: string;
}

export interface ClearPrimaryGmailRefreshTokenInput {
  // Internal app user that owns this Gmail connection.
  userId: string;
  // State to apply after removing the stored refresh token.
  status?: Extract<GmailConnectionStatus, "revoked" | "error">;
  // Timestamp to use for the status/token update.
  occurredAt: string;
}

export interface GmailConnectionRepository {
  upsertPrimary(input: UpsertPrimaryGmailConnectionInput): Promise<GmailConnectionRecord>;
  loadPrimaryByUserId(userId: string): Promise<GmailConnectionRecord | null>;
  listActive(limit?: number): Promise<GmailConnectionRecord[]>;
  markRevoked(userId: string, occurredAt: string): Promise<void>;
  markError(userId: string, occurredAt: string): Promise<void>;
  clearRefreshToken(input: ClearPrimaryGmailRefreshTokenInput): Promise<void>;
  removePrimary(userId: string): Promise<void>;
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

export interface OAuthStateRecord {
  state: string;
  userId: string;
  redirectUri: string;
  createdAt: string;
  expiresAt: string;
}

export interface CreateOAuthStateInput {
  state: string;
  userId: string;
  redirectUri: string;
  createdAt: string;
  expiresAt: string;
}

export interface OAuthStateRepository {
  create(input: CreateOAuthStateInput): Promise<void>;
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

export interface ProcessedEmailRepository {
  isProcessed(emailId: string): Promise<boolean>;
  markProcessed(emailId: string): Promise<void>;
}
