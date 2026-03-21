import { describe, expect, it, vi, beforeEach } from "vitest";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
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
  const gmailConnectionRepository = {
    clearRefreshToken,
    upsertPrimary: vi.fn(),
    loadPrimaryByUserId: vi.fn(),
    listActive: vi.fn(),
    markRevoked: vi.fn(),
    markError: vi.fn(),
    removePrimary: vi.fn(),
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 when no authenticated user", async () => {
    const handler = createDisconnectGoogleOAuthHandler({
      authProvider: { getAuthenticatedUser: vi.fn().mockResolvedValue(null) },
      gmailConnectionRepository,
    });

    const response = await handler(makeEvent());

    expect(response.statusCode).toBe(401);
    expect(response.body).toContain("Authentication required");
    expect(clearRefreshToken).not.toHaveBeenCalled();
  });

  it("clears the refresh token and returns 200 on success", async () => {
    clearRefreshToken.mockResolvedValue(undefined);
    const getNow = () => new Date("2026-03-18T10:00:00.000Z");

    const handler = createDisconnectGoogleOAuthHandler({
      authProvider: {
        getAuthenticatedUser: vi.fn().mockResolvedValue({ userId: "google-oauth2|user-123" }),
      },
      gmailConnectionRepository,
      getNow,
    });

    const response = await handler(makeEvent("google-oauth2|user-123"));

    expect(clearRefreshToken).toHaveBeenCalledWith({
      userId: "google-oauth2|user-123",
      status: "revoked",
      occurredAt: "2026-03-18T10:00:00.000Z",
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("disconnected");
  });

  it("returns 404 when no connection exists for the user", async () => {
    clearRefreshToken.mockRejectedValue(
      new ConditionalCheckFailedException({ message: "The conditional request failed", $metadata: {} }),
    );

    const handler = createDisconnectGoogleOAuthHandler({
      authProvider: {
        getAuthenticatedUser: vi.fn().mockResolvedValue({ userId: "google-oauth2|user-456" }),
      },
      gmailConnectionRepository,
    });

    const response = await handler(makeEvent("google-oauth2|user-456"));

    expect(response.statusCode).toBe(404);
    expect(response.body).toContain("No Gmail connection found");
  });

  it("rethrows unexpected errors", async () => {
    clearRefreshToken.mockRejectedValue(new Error("DynamoDB unavailable"));

    const handler = createDisconnectGoogleOAuthHandler({
      authProvider: {
        getAuthenticatedUser: vi.fn().mockResolvedValue({ userId: "google-oauth2|user-789" }),
      },
      gmailConnectionRepository,
    });

    await expect(handler(makeEvent("google-oauth2|user-789"))).rejects.toThrow("DynamoDB unavailable");
  });

  it("returns 401 when the JWT does not represent an end user", async () => {
    const handler = createDisconnectGoogleOAuthHandler({
      authProvider: new JwtAuthenticatedAppUserProvider(),
      gmailConnectionRepository,
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
    expect(clearRefreshToken).not.toHaveBeenCalled();
  });
});
