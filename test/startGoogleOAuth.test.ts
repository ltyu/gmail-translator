import { describe, expect, it, vi, beforeEach } from "vitest";
import { createStartGoogleOAuthHandler } from "../src/handlers/startGoogleOAuth.js";

describe("startGoogleOAuth", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      APP_SECRETS_SSM_PREFIX: "/gmail-translator",
      GOOGLE_OAUTH_CALLBACK_URL: "https://example.com/auth/google/callback",
      GOOGLE_OAUTH_STATES_TABLE: "oauth-states",
    };
  });

  it("rejects unauthenticated requests", async () => {
    const handler = createStartGoogleOAuthHandler({
      parameterStore: { loadParams: vi.fn() } as any,
      authProvider: { getAuthenticatedUser: vi.fn().mockResolvedValue(null) },
      oauthStateRepository: { create: vi.fn() },
    });

    const response = await handler({ headers: {} } as any);

    expect(response.statusCode).toBe(401);
    expect(response.body).toContain("Authentication required");
  });

  it("persists state and redirects to Google consent", async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const handler = createStartGoogleOAuthHandler({
      parameterStore: {
        loadParams: vi.fn().mockResolvedValue({
          anthropicApiKey: "anthropic",
          gmailOAuthClientId: "client-id",
          gmailOAuthClientSecret: "client-secret",
        }),
      } as any,
      authProvider: { getAuthenticatedUser: vi.fn().mockResolvedValue({ userId: "user-123" }) },
      oauthStateRepository: { create },
      createState: () => "state-123",
      getNow: () => new Date("2026-03-17T10:00:00.000Z"),
    });

    const response = await handler({ headers: { "x-authenticated-user-id": "user-123" } } as any);

    expect(create).toHaveBeenCalledWith({
      state: "state-123",
      userId: "user-123",
      redirectUri: "https://example.com/auth/google/callback",
      createdAt: "2026-03-17T10:00:00.000Z",
      expiresAt: "2026-03-17T10:10:00.000Z",
    });
    expect(response.statusCode).toBe(302);
    expect(response.headers?.location).toContain("https://accounts.google.com/o/oauth2/v2/auth?");
    expect(response.headers?.location).toContain("client_id=client-id");
    expect(response.headers?.location).toContain("redirect_uri=https%3A%2F%2Fexample.com%2Fauth%2Fgoogle%2Fcallback");
    expect(response.headers?.location).toContain("access_type=offline");
    expect(response.headers?.location).toContain("prompt=consent");
    expect(response.headers?.location).toContain("state=state-123");
  });
});
