import { describe, expect, it, vi } from "vitest";
import { DynamoDbOAuthStateRepository } from "../src/services/dynamoDbOAuthStateRepository.js";

describe("DynamoDbOAuthStateRepository", () => {
  it("stores oauth state with ttl", async () => {
    const send = vi.fn().mockResolvedValue({});
    const repository = new DynamoDbOAuthStateRepository({ send } as any, "oauth-states");

    await repository.create({
      state: "state-123",
      userId: "user-123",
      redirectUri: "https://example.com/auth/google/callback",
      createdAt: "2026-03-17T10:00:00.000Z",
      expiresAt: "2026-03-17T10:10:00.000Z",
    });

    const command = send.mock.calls[0][0];
    expect(command.input.TableName).toBe("oauth-states");
    expect(command.input.Item).toEqual({
      state: "state-123",
      userId: "user-123",
      redirectUri: "https://example.com/auth/google/callback",
      createdAt: "2026-03-17T10:00:00.000Z",
      expiresAt: "2026-03-17T10:10:00.000Z",
      ttl: Math.floor(new Date("2026-03-17T10:10:00.000Z").getTime() / 1000),
    });
    expect(command.input.ConditionExpression).toBe("attribute_not_exists(#state)");
  });

  it("consumes oauth state records", async () => {
    const send = vi.fn().mockResolvedValue({
      Attributes: {
        state: "state-123",
        userId: "user-123",
        redirectUri: "https://example.com/auth/google/callback",
        createdAt: "2026-03-17T10:00:00.000Z",
        expiresAt: "2026-03-17T10:10:00.000Z",
        ttl: 1773742200,
      },
    });
    const repository = new DynamoDbOAuthStateRepository({ send } as any, "oauth-states");

    await expect(repository.consume("state-123")).resolves.toEqual({
      state: "state-123",
      userId: "user-123",
      redirectUri: "https://example.com/auth/google/callback",
      createdAt: "2026-03-17T10:00:00.000Z",
      expiresAt: "2026-03-17T10:10:00.000Z",
    });

    const command = send.mock.calls[0][0];
    expect(command.input.Key).toEqual({ state: "state-123" });
    expect(command.input.ReturnValues).toBe("ALL_OLD");
  });
});
