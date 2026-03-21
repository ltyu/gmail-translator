export type AppConfig = {
  processedEmailTable: string;
  appSecretsPrefix: string;
  gmailConnectionsTable?: string;
  gmailConnectionsStatusIndex?: string;
  gmailTokenKmsKeyId?: string;
  googleOAuthCallbackUrl?: string;
};

export type AppSecrets = {
  anthropicApiKey: string;
  gmailOAuthClientId: string;
  gmailOAuthClientSecret: string;
};

export type GmailOAuthAppCredentials = {
  clientId: string;
  clientSecret: string;
};

export type TokenExchangeResult = {
  refreshToken?: string;
  accessToken?: string;
};

export type GoogleAccountProfile = {
  googleSub: string;
  gmailAddress?: string;
};

export interface IGoogleOAuthClient {
  exchangeCodeForTokens(input: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    code: string;
  }): Promise<TokenExchangeResult>;
  getGoogleAccountProfile(input: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    accessToken?: string;
    refreshToken?: string;
  }): Promise<GoogleAccountProfile>;
  revokeToken(token: string): Promise<void>;
  buildConsentUrl(clientId: string, callbackUrl: string, state: string): string;
}

export const GMAIL_CONNECTION_STATUSES = ["active", "revoked", "error"] as const;

export type GmailConnectionStatus = (typeof GMAIL_CONNECTION_STATUSES)[number];

export const PRIMARY_GMAIL_CONNECTION_ID = "primary" as const;

export type GmailConnectionRecord = {
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
};

export type UpsertPrimaryGmailConnectionInput = {
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
};

export type ClearPrimaryGmailRefreshTokenInput = {
  // Internal app user that owns this Gmail connection.
  userId: string;
  // State to apply after removing the stored refresh token.
  status?: Extract<GmailConnectionStatus, "revoked" | "error">;
  // Timestamp to use for the status/token update.
  occurredAt: string;
};

export interface IGmailConnectionRepository {
  upsertPrimary(input: UpsertPrimaryGmailConnectionInput): Promise<GmailConnectionRecord>;
  loadPrimaryByUserId(userId: string): Promise<GmailConnectionRecord | null>;
  listActive(limit?: number): Promise<GmailConnectionRecord[]>;
  markRevoked(userId: string, occurredAt: string): Promise<void>;
  markError(userId: string, occurredAt: string): Promise<void>;
  clearRefreshToken(input: ClearPrimaryGmailRefreshTokenInput): Promise<void>;
  removePrimary(userId: string): Promise<void>;
}

export type GmailTokenEncryptionContext = {
  userId: string;
  connectionId?: string;
};

export interface IGmailTokenEncryptionService {
  encryptRefreshToken(token: string, context: GmailTokenEncryptionContext): Promise<string>;
  decryptRefreshToken(ciphertext: string, context: GmailTokenEncryptionContext): Promise<string>;
}

export interface IAuthenticatedAppUser {
  userId: string;
}

export interface IAuthenticatedAppUserProvider<TRequestContext = unknown> {
  getAuthenticatedUser(context: TRequestContext): Promise<IAuthenticatedAppUser | null>;
}

// Claims injected by API Gateway after verifying a JWT issued by Auth0.
// The `sub` claim is the stable user identifier (e.g. "google-oauth2|1234567890").
export type JwtClaims = {
  sub: string;
  [claim: string]: string;
};

export type OAuthStateRecord = {
  state: string;
  userId: string;
  redirectUri: string;
  createdAt: string;
  expiresAt: string;
};

export type CreateOAuthStateInput = {
  state: string;
  userId: string;
  redirectUri: string;
  createdAt: string;
  expiresAt: string;
};

export interface IOAuthStateRepository {
  create(input: CreateOAuthStateInput): Promise<void>;
  consume(state: string): Promise<OAuthStateRecord | null>;
}

export type InboxMessageSummary = {
  id: string;
};

export type EmailMessage = {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  messageId: string;
  bodyText: string;
};

export type SendReplyInput = {
  to: string;
  subject: string;
  messageId: string;
  threadId: string;
  translation: string;
  originalText: string;
};

export interface IGmailService {
  getAuthenticatedEmail(): Promise<string>;
  listRecentInboxMessages(sinceEpochSeconds: number): Promise<InboxMessageSummary[]>;
  getMessage(id: string): Promise<EmailMessage>;
  sendReply(input: SendReplyInput): Promise<void>;
}

export interface ITranslationService {
  translateText(text: string): Promise<string>;
}

export interface IProcessedEmailRepository {
  isProcessed(emailId: string): Promise<boolean>;
  markProcessed(emailId: string): Promise<void>;
}
