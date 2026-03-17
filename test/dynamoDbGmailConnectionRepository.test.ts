import { describe, expect, it, vi } from "vitest";
import { DynamoDbGmailConnectionRepository } from "../src/services/dynamoDbGmailConnectionRepository.js";

describe("DynamoDbGmailConnectionRepository", () => {
  it("upserts the primary connection with a lean schema", async () => {
    const send = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({});
    const repository = new DynamoDbGmailConnectionRepository({ send } as any, "gmail-connections", "status-index");

    const record = await repository.upsertPrimary({
      userId: "user-123",
      googleSub: "google-sub-123",
      gmailAddress: "person@example.com",
      encryptedRefreshToken: "ciphertext",
      occurredAt: "2026-03-17T10:00:00.000Z",
    });

    expect(record).toEqual({
      userId: "user-123",
      connectionId: "primary",
      status: "active",
      googleSub: "google-sub-123",
      gmailAddress: "person@example.com",
      encryptedRefreshToken: "ciphertext",
      createdAt: "2026-03-17T10:00:00.000Z",
      updatedAt: "2026-03-17T10:00:00.000Z",
    });

    const getCommand = send.mock.calls[0][0];
    expect(getCommand.input.Key).toEqual({
      pk: "user-123",
      sk: "primary",
    });

    const putCommand = send.mock.calls[1][0];
    expect(putCommand.input.Item).toEqual({
      pk: "user-123",
      sk: "primary",
      gsi1pk: "active",
      gsi1sk: "2026-03-17T10:00:00.000Z",
      status: "active",
      googleSub: "google-sub-123",
      gmailAddress: "person@example.com",
      encryptedRefreshToken: "ciphertext",
      createdAt: "2026-03-17T10:00:00.000Z",
      updatedAt: "2026-03-17T10:00:00.000Z",
    });
  });

  it("loads the primary connection by user id", async () => {
    const send = vi.fn().mockResolvedValue({
      Item: {
        pk: "user-123",
        sk: "primary",
        gsi1pk: "active",
        gsi1sk: "2026-03-17T10:00:00.000Z",
        status: "active",
        googleSub: "google-sub-123",
        gmailAddress: "person@example.com",
        encryptedRefreshToken: "ciphertext",
        createdAt: "2026-03-17T10:00:00.000Z",
        updatedAt: "2026-03-17T10:00:00.000Z",
      },
    });
    const repository = new DynamoDbGmailConnectionRepository({ send } as any, "gmail-connections", "status-index");

    await expect(repository.loadPrimaryByUserId("user-123")).resolves.toEqual({
      userId: "user-123",
      connectionId: "primary",
      status: "active",
      googleSub: "google-sub-123",
      gmailAddress: "person@example.com",
      encryptedRefreshToken: "ciphertext",
      createdAt: "2026-03-17T10:00:00.000Z",
      updatedAt: "2026-03-17T10:00:00.000Z",
    });
  });

  it("lists active connections through the status index", async () => {
    const send = vi.fn().mockResolvedValue({
      Items: [
        {
          pk: "user-123",
          sk: "primary",
          gsi1pk: "active",
          gsi1sk: "2026-03-17T10:00:00.000Z",
          status: "active",
          googleSub: "google-sub-123",
          createdAt: "2026-03-17T10:00:00.000Z",
          updatedAt: "2026-03-17T10:00:00.000Z",
        },
      ],
    });
    const repository = new DynamoDbGmailConnectionRepository({ send } as any, "gmail-connections", "status-index");

    const records = await repository.listActive(25);

    expect(records).toEqual([
      {
        userId: "user-123",
        connectionId: "primary",
        status: "active",
        googleSub: "google-sub-123",
        gmailAddress: undefined,
        encryptedRefreshToken: undefined,
        createdAt: "2026-03-17T10:00:00.000Z",
        updatedAt: "2026-03-17T10:00:00.000Z",
      },
    ]);

    const command = send.mock.calls[0][0];
    expect(command.input.IndexName).toBe("status-index");
    expect(command.input.ExpressionAttributeValues).toEqual({
      ":status": "active",
    });
    expect(command.input.Limit).toBe(25);
  });

  it("keeps querying active connections until all pages are loaded", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        Items: [
          {
            pk: "user-123",
            sk: "primary",
            gsi1pk: "active",
            gsi1sk: "2026-03-17T10:00:00.000Z",
            status: "active",
            googleSub: "google-sub-123",
            createdAt: "2026-03-17T10:00:00.000Z",
            updatedAt: "2026-03-17T10:00:00.000Z",
          },
        ],
        LastEvaluatedKey: { pk: "user-123", sk: "primary" },
      })
      .mockResolvedValueOnce({
        Items: [
          {
            pk: "user-456",
            sk: "primary",
            gsi1pk: "active",
            gsi1sk: "2026-03-17T10:05:00.000Z",
            status: "active",
            googleSub: "google-sub-456",
            createdAt: "2026-03-17T10:05:00.000Z",
            updatedAt: "2026-03-17T10:05:00.000Z",
          },
        ],
      });
    const repository = new DynamoDbGmailConnectionRepository({ send } as any, "gmail-connections", "status-index");

    const records = await repository.listActive();

    expect(records).toHaveLength(2);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].input.ExclusiveStartKey).toEqual({ pk: "user-123", sk: "primary" });
  });

  it("marks a connection revoked", async () => {
    const send = vi.fn().mockResolvedValue({});
    const repository = new DynamoDbGmailConnectionRepository({ send } as any, "gmail-connections", "status-index");

    await repository.markRevoked("user-123", "2026-03-17T12:30:00.000Z");

    const command = send.mock.calls[0][0];
    expect(command.input.ConditionExpression).toBe("attribute_exists(pk) AND attribute_exists(sk)");
    expect(command.input.ExpressionAttributeValues).toMatchObject({
      ":status": "revoked",
      ":gsi1pk": "revoked",
      ":gsi1sk": "2026-03-17T12:30:00.000Z",
    });
  });

  it("marks a connection error", async () => {
    const send = vi.fn().mockResolvedValue({});
    const repository = new DynamoDbGmailConnectionRepository({ send } as any, "gmail-connections", "status-index");

    await repository.markError("user-123", "2026-03-17T12:30:00.000Z");

    const command = send.mock.calls[0][0];
    expect(command.input.ExpressionAttributeValues).toMatchObject({
      ":status": "error",
      ":gsi1pk": "error",
    });
  });

  it("clears the stored refresh token and updates status", async () => {
    const send = vi.fn().mockResolvedValue({});
    const repository = new DynamoDbGmailConnectionRepository({ send } as any, "gmail-connections", "status-index");

    await repository.clearRefreshToken({
      userId: "user-123",
      status: "revoked",
      occurredAt: "2026-03-17T12:30:00.000Z",
    });

    const command = send.mock.calls[0][0];
    expect(command.input.ConditionExpression).toBe("attribute_exists(pk) AND attribute_exists(sk)");
    expect(command.input.ExpressionAttributeValues).toMatchObject({
      ":status": "revoked",
      ":gsi1pk": "revoked",
      ":encryptedRefreshToken": null,
    });
  });

  it("removes the primary connection item", async () => {
    const send = vi.fn().mockResolvedValue({});
    const repository = new DynamoDbGmailConnectionRepository({ send } as any, "gmail-connections", "status-index");

    await repository.removePrimary("user-123");

    const command = send.mock.calls[0][0];
    expect(command.input.Key).toEqual({
      pk: "user-123",
      sk: "primary",
    });
  });
});
