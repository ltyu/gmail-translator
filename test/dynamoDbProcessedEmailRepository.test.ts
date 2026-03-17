import { describe, expect, it, vi } from "vitest";
import { DynamoDbProcessedEmailRepository } from "../src/services/dynamoDbProcessedEmailRepository.js";

describe("DynamoDbProcessedEmailRepository", () => {
  it("returns whether an email was processed", async () => {
    const send = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ Item: { email_id: "abc" } });
    const repository = new DynamoDbProcessedEmailRepository({ send } as any, "emails");

    await expect(repository.isProcessed("a")).resolves.toBe(false);
    await expect(repository.isProcessed("b")).resolves.toBe(true);
  });

  it("writes ttl and processed timestamp", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T12:00:00.000Z"));

    const send = vi.fn().mockResolvedValue({});
    const repository = new DynamoDbProcessedEmailRepository({ send } as any, "emails");

    await repository.markProcessed("abc");

    const command = send.mock.calls[0][0];
    expect(command.input.TableName).toBe("emails");
    expect(command.input.Item.email_id).toBe("abc");
    expect(command.input.Item.processed_at).toBe("2026-03-14T12:00:00.000Z");
    expect(command.input.Item.ttl).toBe(1776081600);

    vi.useRealTimers();
  });
});
