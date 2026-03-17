import { describe, expect, it, vi } from "vitest";
import { DynamoDbProcessedEmailRepository } from "./dynamoDbProcessedEmailRepository.js";

describe("DynamoDbProcessedEmailRepository", () => {
  it("returns whether an email was processed", async () => {
    const send = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ Item: { email_id: "abc" } });
    const repository = new DynamoDbProcessedEmailRepository({ send } as any, "emails");
    const scope = { userId: "user-123", connectionId: "primary" };

    await expect(repository.isProcessed(scope, "a")).resolves.toBe(false);
    await expect(repository.isProcessed(scope, "b")).resolves.toBe(true);

    expect(send.mock.calls[0][0].input.Key).toEqual({
      connection_id: "user-123:primary",
      email_id: "a",
    });
  });

  it("writes ttl and processed timestamp", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T12:00:00.000Z"));

    const send = vi.fn().mockResolvedValue({});
    const repository = new DynamoDbProcessedEmailRepository({ send } as any, "emails");
    const scope = { userId: "user-123", connectionId: "primary" };

    await repository.markProcessed(scope, "abc");

    const command = send.mock.calls[0][0];
    expect(command.input.TableName).toBe("emails");
    expect(command.input.Item.connection_id).toBe("user-123:primary");
    expect(command.input.Item.email_id).toBe("abc");
    expect(command.input.Item.processed_at).toBe("2026-03-14T12:00:00.000Z");
    expect(command.input.Item.ttl).toBe(1776081600);

    vi.useRealTimers();
  });
});
