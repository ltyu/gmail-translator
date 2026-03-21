import { describe, expect, it } from "vitest";
import { JwtAuthenticatedAppUserProvider } from "./jwtAuthenticatedAppUserProvider.js";

function makeEvent(sub?: unknown) {
  return {
    requestContext: {
      authorizer: {
        jwt: {
          claims: sub !== undefined ? { sub } : {},
          scopes: [],
        },
      },
    },
  } as any;
}

describe("JwtAuthenticatedAppUserProvider", () => {
  const provider = new JwtAuthenticatedAppUserProvider();

  it("returns userId from the JWT sub claim", async () => {
    const result = await provider.getAuthenticatedUser(
      makeEvent("google-oauth2|user-123"),
    );
    expect(result).toEqual({ userId: "google-oauth2|user-123" });
  });

  it("returns null when sub claim is missing", async () => {
    const result = await provider.getAuthenticatedUser(makeEvent());
    expect(result).toBeNull();
  });

  it("returns null when sub claim is not a string", async () => {
    const result = await provider.getAuthenticatedUser(makeEvent(12345));
    expect(result).toBeNull();
  });

  it("returns null when sub claim is an empty string", async () => {
    const result = await provider.getAuthenticatedUser(makeEvent(""));
    expect(result).toBeNull();
  });

  it("returns null for client credentials tokens", async () => {
    const result = await provider.getAuthenticatedUser({
      requestContext: {
        authorizer: {
          jwt: {
            claims: { sub: "machine-client@clients", gty: "client-credentials" },
            scopes: [],
          },
        },
      },
    } as any);

    expect(result).toBeNull();
  });
});
