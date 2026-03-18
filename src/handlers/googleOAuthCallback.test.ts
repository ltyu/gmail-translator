import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGoogleOAuthCallbackHandler } from "./googleOAuthCallback.js";

describe("googleOAuthCallback", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      APP_SECRETS_SSM_PREFIX: "/gmail-translator",
      GOOGLE_OAUTH_STATES_TABLE: "oauth-states",
      GMAIL_CONNECTIONS_TABLE: "gmail-connections",
      GMAIL_CONNECTIONS_STATUS_INDEX: "gsi1",
      GMAIL_TOKEN_KMS_KEY_ID: "alias/gmail-refresh-token",
      GMAIL_CONNECTION_SUCCESS_REDIRECT_URL: "https://example.com/settings/integrations/gmail/success",
      GMAIL_CONNECTION_FAILURE_REDIRECT_URL: "https://example.com/settings/integrations/gmail/error",
    };
  });

  it("redirects to failure when state or code is missing", async () => {
    const handler = createGoogleOAuthCallbackHandler({
      parameterStore: { loadParams: vi.fn() } as any,
      oauthStateRepository: { create: vi.fn(), consume: vi.fn() },
      gmailConnectionRepository: { upsertPrimary: vi.fn() } as any,
      tokenEncryptionService: { encryptRefreshToken: vi.fn() } as any,
      googleOAuthClient: {
        exchangeCodeForTokens: vi.fn(),
        getGoogleAccountProfile: vi.fn(),
        buildConsentUrl: vi.fn(),
      },
    });

    const response = await handler({ queryStringParameters: {} } as any);

    expect(response.statusCode).toBe(302);
    expect(response.headers?.location).toBe(
      "https://example.com/settings/integrations/gmail/error",
    );
  });

  it("consumes state, encrypts token, and upserts the Gmail connection", async () => {
    const upsertPrimary = vi.fn().mockResolvedValue(undefined);
    const handler = createGoogleOAuthCallbackHandler({
      parameterStore: {
        loadParams: vi.fn().mockResolvedValue({
          anthropicApiKey: "anthropic",
          gmailOAuthClientId: "client-id",
          gmailOAuthClientSecret: "client-secret",
        }),
      } as any,
      oauthStateRepository: {
        create: vi.fn(),
        consume: vi.fn().mockResolvedValue({
          state: "state-123",
          userId: "user-123",
          redirectUri: "https://example.com/auth/google/callback",
          createdAt: "2026-03-17T10:00:00.000Z",
          expiresAt: "2026-03-17T10:10:00.000Z",
        }),
      },
      gmailConnectionRepository: { upsertPrimary } as any,
      tokenEncryptionService: {
        encryptRefreshToken: vi.fn().mockResolvedValue("encrypted-token"),
      } as any,
      googleOAuthClient: {
        exchangeCodeForTokens: vi.fn().mockResolvedValue({
          refreshToken: "refresh-token",
          accessToken: "access-token",
        }),
        getGoogleAccountProfile: vi.fn().mockResolvedValue({
          googleSub: "google-sub-123",
          gmailAddress: "person@example.com",
        }),
        buildConsentUrl: vi.fn(),
      },
      getNow: () => new Date("2026-03-17T10:05:00.000Z"),
      logger: { error: vi.fn() },
    });

    const response = await handler({
      queryStringParameters: {
        code: "auth-code",
        state: "state-123",
      },
    } as any);

    expect(upsertPrimary).toHaveBeenCalledWith({
      userId: "user-123",
      googleSub: "google-sub-123",
      gmailAddress: "person@example.com",
      encryptedRefreshToken: "encrypted-token",
      status: "active",
      occurredAt: "2026-03-17T10:05:00.000Z",
    });
    expect(response.statusCode).toBe(302);
    expect(response.headers?.location).toBe(
      "https://example.com/settings/integrations/gmail/success",
    );
  });

  it("redirects to failure when Google does not return a refresh token", async () => {
    const logger = { error: vi.fn() };
    const handler = createGoogleOAuthCallbackHandler({
      parameterStore: {
        loadParams: vi.fn().mockResolvedValue({
          anthropicApiKey: "anthropic",
          gmailOAuthClientId: "client-id",
          gmailOAuthClientSecret: "client-secret",
        }),
      } as any,
      oauthStateRepository: {
        create: vi.fn(),
        consume: vi.fn().mockResolvedValue({
          state: "state-123",
          userId: "user-123",
          redirectUri: "https://example.com/auth/google/callback",
          createdAt: "2026-03-17T10:00:00.000Z",
          expiresAt: "2026-03-17T10:10:00.000Z",
        }),
      },
      gmailConnectionRepository: { upsertPrimary: vi.fn() } as any,
      tokenEncryptionService: { encryptRefreshToken: vi.fn() } as any,
      googleOAuthClient: {
        exchangeCodeForTokens: vi.fn().mockResolvedValue({ accessToken: "access-token" }),
        getGoogleAccountProfile: vi.fn(),
        buildConsentUrl: vi.fn(),
      },
      getNow: () => new Date("2026-03-17T10:05:00.000Z"),
      logger,
    });

    const response = await handler({
      queryStringParameters: {
        code: "auth-code",
        state: "state-123",
      },
    } as any);

    expect(logger.error).toHaveBeenCalledWith(
      "Google OAuth callback did not return a refresh token",
      { userId: "user-123" },
    );
    expect(response.headers?.location).toBe(
      "https://example.com/settings/integrations/gmail/error",
    );
  });
});
