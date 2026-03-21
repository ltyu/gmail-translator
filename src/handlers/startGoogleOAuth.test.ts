import { describe, expect, it, vi, beforeEach } from "vitest";
import { createStartGoogleOAuthHandler } from "./startGoogleOAuth.js";
import { JwtAuthenticatedAppUserProvider } from "../services/jwtAuthenticatedAppUserProvider.js";

describe("startGoogleOAuth", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      APP_SECRETS_SSM_PREFIX: "/gmail-translator",
      GOOGLE_OAUTH_STATES_TABLE: "oauth-states",
    };
  });

  it("rejects unauthenticated requests", async () => {
    const handler = createStartGoogleOAuthHandler({
      parameterStore: { loadParams: vi.fn() } as any,
      authProvider: { getAuthenticatedUser: vi.fn().mockResolvedValue(null) },
      oauthStateRepository: { create: vi.fn(), consume: vi.fn() },
    });

    const response = await handler({ headers: {} } as any);

    expect(response.statusCode).toBe(401);
    expect(response.body).toContain("Authentication required");
  });

  it("persists state and returns the Google consent URL", async () => {
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
      oauthStateRepository: { create, consume: vi.fn() },
      createState: () => "state-123",
      getNow: () => new Date("2026-03-17T10:00:00.000Z"),
    });

    const response = await handler({
      headers: {},
      requestContext: {
        domainName: "example.com",
        stage: "$default",
        authorizer: {
            jwt: {
              claims: { sub: "google-oauth2|user-123" },
              scopes: ["gmail:connect"],
            },
          },
        },
      } as any);

    expect(create).toHaveBeenCalledWith({
      state: "state-123",
      userId: "user-123",
      redirectUri: "https://example.com/auth/google/callback",
      createdAt: "2026-03-17T10:00:00.000Z",
      expiresAt: "2026-03-17T10:10:00.000Z",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers?.["content-type"]).toBe("application/json");

    const body = JSON.parse(response.body ?? "{}");

    expect(body.authorizationUrl).toContain("https://accounts.google.com/o/oauth2/v2/auth?");
    expect(body.authorizationUrl).toContain("client_id=client-id");
    expect(body.authorizationUrl).toContain(
      "redirect_uri=https%3A%2F%2Fexample.com%2Fauth%2Fgoogle%2Fcallback",
    );
    expect(body.authorizationUrl).toContain("access_type=offline");
    expect(body.authorizationUrl).toContain("prompt=consent");
    expect(body.authorizationUrl).toContain("scope=openid+email+");
    expect(body.authorizationUrl).toContain("state=state-123");
  });

  it("rejects machine-to-machine tokens", async () => {
    const handler = createStartGoogleOAuthHandler({
      parameterStore: { loadParams: vi.fn() } as any,
      authProvider: new JwtAuthenticatedAppUserProvider(["gmail:connect"]),
      oauthStateRepository: { create: vi.fn(), consume: vi.fn() },
    });

    const response = await handler({
      requestContext: {
        domainName: "example.com",
        stage: "$default",
        authorizer: {
          jwt: {
            claims: { sub: "machine-client@clients", gty: "client-credentials" },
            scopes: ["gmail:connect"],
          },
        },
      },
    } as any);

    expect(response.statusCode).toBe(401);
  });
});
