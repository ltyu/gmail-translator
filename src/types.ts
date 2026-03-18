export interface IAppConfig {
  processedEmailTable: string;
  appSecretsPrefix: string;
  gmailConnectionsTable?: string;
  gmailConnectionsStatusIndex?: string;
  gmailTokenKmsKeyId?: string;
  googleOAuthCallbackUrl?: string;
}

export interface IAppSecrets {
  anthropicApiKey: string;
  gmailOAuthClientId: string;
  gmailOAuthClientSecret: string;
}

export interface IGmailOAuthAppCredentials {
  clientId: string;
  clientSecret: string;
}

export interface ITokenExchangeResult {
  refreshToken?: string;
  accessToken?: string;
}

export interface IGoogleAccountProfile {
  googleSub: string;
  gmailAddress?: string;
}

export interface IGoogleOAuthClient {
  exchangeCodeForTokens(input: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    code: string;
  }): Promise<ITokenExchangeResult>;
  getGoogleAccountProfile(input: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    accessToken?: string;
    refreshToken?: string;
  }): Promise<IGoogleAccountProfile>;
  buildConsentUrl(clientId: string, callbackUrl: string, state: string): string;
}

export const GMAIL_CONNECTION_STATUSES = ["active", "revoked", "error"] as const;

export type GmailConnectionStatus = (typeof GMAIL_CONNECTION_STATUSES)[number];

export const PRIMARY_GMAIL_CONNECTION_ID = "primary" as const;

export interface IGmailConnectionRecord {
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

export interface IUpsertPrimaryGmailConnectionInput {
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

export interface IClearPrimaryGmailRefreshTokenInput {
  // Internal app user that owns this Gmail connection.
  userId: string;
  // State to apply after removing the stored refresh token.
  status?: Extract<GmailConnectionStatus, "revoked" | "error">;
  // Timestamp to use for the status/token update.
  occurredAt: string;
}

export interface IGmailConnectionRepository {
  upsertPrimary(input: IUpsertPrimaryGmailConnectionInput): Promise<IGmailConnectionRecord>;
  loadPrimaryByUserId(userId: string): Promise<IGmailConnectionRecord | null>;
  listActive(limit?: number): Promise<IGmailConnectionRecord[]>;
  markRevoked(userId: string, occurredAt: string): Promise<void>;
  markError(userId: string, occurredAt: string): Promise<void>;
  clearRefreshToken(input: IClearPrimaryGmailRefreshTokenInput): Promise<void>;
  removePrimary(userId: string): Promise<void>;
}

export interface IGmailTokenEncryptionContext {
  userId: string;
  connectionId?: string;
}

export interface IGmailTokenEncryptionService {
  encryptRefreshToken(token: string, context: IGmailTokenEncryptionContext): Promise<string>;
  decryptRefreshToken(ciphertext: string, context: IGmailTokenEncryptionContext): Promise<string>;
}

export interface IAuthenticatedAppUser {
  userId: string;
}

export interface IAuthenticatedAppUserProvider<TRequestContext = unknown> {
  getAuthenticatedUser(context: TRequestContext): Promise<IAuthenticatedAppUser | null>;
}

export interface IOAuthStateRecord {
  state: string;
  userId: string;
  redirectUri: string;
  createdAt: string;
  expiresAt: string;
}

export interface ICreateOAuthStateInput {
  state: string;
  userId: string;
  redirectUri: string;
  createdAt: string;
  expiresAt: string;
}

export interface IOAuthStateRepository {
  create(input: ICreateOAuthStateInput): Promise<void>;
  consume(state: string): Promise<IOAuthStateRecord | null>;
}

export interface IInboxMessageSummary {
  id: string;
}

export interface IEmailMessage {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  messageId: string;
  bodyText: string;
}

export interface ISendReplyInput {
  to: string;
  subject: string;
  messageId: string;
  threadId: string;
  translation: string;
  originalText: string;
}

export interface IGmailService {
  getAuthenticatedEmail(): Promise<string>;
  listRecentInboxMessages(sinceEpochSeconds: number): Promise<IInboxMessageSummary[]>;
  getMessage(id: string): Promise<IEmailMessage>;
  sendReply(input: ISendReplyInput): Promise<void>;
}

export interface ITranslationService {
  translateText(text: string): Promise<string>;
}

export interface IProcessedEmailRepository {
  isProcessed(emailId: string): Promise<boolean>;
  markProcessed(emailId: string): Promise<void>;
}
