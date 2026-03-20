import { describe, expect, it, vi, beforeEach } from "vitest";
import { createDisconnectGoogleOAuthHandler } from "./disconnectGoogleOAuth.js";
import { JwtAuthenticatedAppUserProvider } from "../services/jwtAuthenticatedAppUserProvider.js";

function makeEvent(sub?: string) {
  return {
    requestContext: {
      authorizer: {
        jwt: {
          claims: sub ? { sub } : {},
          scopes: [],
        },
      },
    },
  } as any;
}

describe("disconnectGoogleOAuth", () => {
  const clearRefreshToken = vi.fn();
  const loadPrimaryByUserId = vi.fn();
  const decryptRefreshToken = vi.fn();
  const revokeToken = vi.fn();
  const gmailConnectionRepository = {
    clearRefreshToken,
    loadPrimaryByUserId,
    upsertPrimary: vi.fn(),
    listActive: vi.fn(),
    markRevoked: vi.fn(),
    markError: vi.fn(),
    removePrimary: vi.fn(),
  };
  const tokenEncryptionService = {
    encryptRefreshToken: vi.fn(),
    decryptRefreshToken,
  };
  const googleOAuthClient = {
    exchangeCodeForTokens: vi.fn(),
    getGoogleAccountProfile: vi.fn(),
    revokeToken,
    buildConsentUrl: vi.fn(),
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 when no authenticated user", async () => {
    const handler = createDisconnectGoogleOAuthHandler({
      authProvider: { getAuthenticatedUser: vi.fn().mockResolvedValue(null) },
      gmailConnectionRepository,
      tokenEncryptionService: tokenEncryptionService as any,
      googleOAuthClient: googleOAuthClient as any,
    });

    const response = await handler(makeEvent());

    expect(response.statusCode).toBe(401);
    expect(response.body).toContain("Authentication required");
    expect(loadPrimaryByUserId).not.toHaveBeenCalled();
    expect(clearRefreshToken).not.toHaveBeenCalled();
  });

  it("revokes the Google token, clears the refresh token, and returns 200", async () => {
    loadPrimaryByUserId.mockResolvedValue({
      userId: "google-oauth2|user-123",
      connectionId: "primary",
      status: "active",
      googleSub: "google-sub-123",
      encryptedRefreshToken: "ciphertext",
      createdAt: "2026-03-18T09:00:00.000Z",
      updatedAt: "2026-03-18T09:00:00.000Z",
    });
    decryptRefreshToken.mockResolvedValue("refresh-token");
    revokeToken.mockResolvedValue(undefined);
    clearRefreshToken.mockResolvedValue(undefined);
    const getNow = () => new Date("2026-03-18T10:00:00.000Z");

    const handler = createDisconnectGoogleOAuthHandler({
      authProvider: {
        getAuthenticatedUser: vi.fn().mockResolvedValue({ userId: "google-oauth2|user-123" }),
      },
      gmailConnectionRepository,
      tokenEncryptionService: tokenEncryptionService as any,
      googleOAuthClient: googleOAuthClient as any,
      getNow,
    });

    const response = await handler(makeEvent("google-oauth2|user-123"));

    expect(loadPrimaryByUserId).toHaveBeenCalledWith("google-oauth2|user-123");
    expect(decryptRefreshToken).toHaveBeenCalledWith("ciphertext", {
      userId: "google-oauth2|user-123",
      connectionId: "primary",
    });
    expect(revokeToken).toHaveBeenCalledWith("refresh-token");
    expect(clearRefreshToken).toHaveBeenCalledWith({
      userId: "google-oauth2|user-123",
      status: "revoked",
      occurredAt: "2026-03-18T10:00:00.000Z",
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("disconnected");
    expect(response.body).toContain('"revokedAtGoogle":true');
  });

  it("returns 404 when no connection exists for the user", async () => {
    loadPrimaryByUserId.mockResolvedValue(null);

    const handler = createDisconnectGoogleOAuthHandler({
      authProvider: {
        getAuthenticatedUser: vi.fn().mockResolvedValue({ userId: "google-oauth2|user-456" }),
      },
      gmailConnectionRepository,
      tokenEncryptionService: tokenEncryptionService as any,
      googleOAuthClient: googleOAuthClient as any,
    });

    const response = await handler(makeEvent("google-oauth2|user-456"));

    expect(response.statusCode).toBe(404);
    expect(response.body).toContain("No Gmail connection found");
    expect(clearRefreshToken).not.toHaveBeenCalled();
  });

  it("still clears the local token when Google revocation fails", async () => {
    loadPrimaryByUserId.mockResolvedValue({
      userId: "google-oauth2|user-123",
      connectionId: "primary",
      status: "active",
      googleSub: "google-sub-123",
      encryptedRefreshToken: "ciphertext",
      createdAt: "2026-03-18T09:00:00.000Z",
      updatedAt: "2026-03-18T09:00:00.000Z",
    });
    decryptRefreshToken.mockResolvedValue("refresh-token");
    revokeToken.mockRejectedValue(new Error("Google unavailable"));
    clearRefreshToken.mockResolvedValue(undefined);
    const logger = { error: vi.fn() };

    const handler = createDisconnectGoogleOAuthHandler({
      authProvider: {
        getAuthenticatedUser: vi.fn().mockResolvedValue({ userId: "google-oauth2|user-123" }),
      },
      gmailConnectionRepository,
      tokenEncryptionService: tokenEncryptionService as any,
      googleOAuthClient: googleOAuthClient as any,
      logger,
    });

    const response = await handler(makeEvent("google-oauth2|user-123"));

    expect(clearRefreshToken).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith("Failed to revoke Google OAuth token", {
      userId: "google-oauth2|user-123",
      error: "Google unavailable",
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('"revokedAtGoogle":false');
  });

  it("rethrows unexpected errors", async () => {
    loadPrimaryByUserId.mockResolvedValue({
      userId: "google-oauth2|user-789",
      connectionId: "primary",
      status: "active",
      googleSub: "google-sub-789",
      encryptedRefreshToken: undefined,
      createdAt: "2026-03-18T09:00:00.000Z",
      updatedAt: "2026-03-18T09:00:00.000Z",
    });
    clearRefreshToken.mockRejectedValue(new Error("DynamoDB unavailable"));

    const handler = createDisconnectGoogleOAuthHandler({
      authProvider: {
        getAuthenticatedUser: vi.fn().mockResolvedValue({ userId: "google-oauth2|user-789" }),
      },
      gmailConnectionRepository,
      tokenEncryptionService: tokenEncryptionService as any,
      googleOAuthClient: googleOAuthClient as any,
    });

    await expect(handler(makeEvent("google-oauth2|user-789"))).rejects.toThrow("DynamoDB unavailable");
  });

  it("returns 401 when the JWT does not represent an end user", async () => {
    const handler = createDisconnectGoogleOAuthHandler({
      authProvider: new JwtAuthenticatedAppUserProvider(["gmail:disconnect"]),
      gmailConnectionRepository,
      tokenEncryptionService: tokenEncryptionService as any,
      googleOAuthClient: googleOAuthClient as any,
    });

    const response = await handler({
      requestContext: {
        authorizer: {
          jwt: {
            claims: { sub: "machine-client@clients", gty: "client-credentials" },
            scopes: ["gmail:disconnect"],
          },
        },
      },
    } as any);

    expect(response.statusCode).toBe(401);
    expect(loadPrimaryByUserId).not.toHaveBeenCalled();
    expect(clearRefreshToken).not.toHaveBeenCalled();
  });
});
