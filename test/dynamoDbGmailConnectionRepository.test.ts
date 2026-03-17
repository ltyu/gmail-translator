import { describe, expect, it, vi } from "vitest";
import { DynamoDbGmailConnectionRepository } from "../src/services/dynamoDbGmailConnectionRepository.js";

describe("DynamoDbGmailConnectionRepository", () => {
  it("upserts a primary user connection with future-proof keys", async () => {
    const send = vi.fn().mockResolvedValueOnce({ Items: [] }).mockResolvedValueOnce({});
    const repository = new DynamoDbGmailConnectionRepository({ send } as any, "gmail-connections", "status-index");

    const record = await repository.upsert({
      userId: "user-123",
      gmailAddress: "person@example.com",
      providerSubject: "google-oauth-subject",
      scopes: ["gmail.readonly", "gmail.send"],
      encryptedRefreshToken: "ciphertext",
      tokenCiphertextVersion: "kms:v1",
      tokenKmsKeyId: "alias/gmail-refresh-token",
      tokenUpdatedAt: "2026-03-17T10:00:00.000Z",
      lastAuthenticatedAt: "2026-03-17T10:00:00.000Z",
    });

    expect(record).toMatchObject({
      userId: "user-123",
      connectionId: "primary",
      status: "active",
      encryptedRefreshToken: "ciphertext",
    });

    const loadCommand = send.mock.calls[0][0];
    expect(loadCommand.input.TableName).toBe("gmail-connections");
    expect(loadCommand.input.KeyConditionExpression).toBe("pk = :pk");
    expect(loadCommand.input.ExpressionAttributeValues).toEqual({
      ":pk": "USER#user-123",
    });

    const putCommand = send.mock.calls[1][0];
    expect(putCommand.input.TableName).toBe("gmail-connections");
    expect(putCommand.input.Item).toMatchObject({
      pk: "USER#user-123",
      sk: "CONNECTION#primary",
      gsi1pk: "STATUS#active",
      gsi1sk: "UPDATED_AT#2026-03-17T10:00:00.000Z#USER#user-123#CONNECTION#primary",
      entityType: "gmail-connection",
      encryptedRefreshToken: "ciphertext",
      tokenCiphertextVersion: "kms:v1",
      tokenKmsKeyId: "alias/gmail-refresh-token",
    });
  });

  it("loads a stored connection by user id", async () => {
    const send = vi.fn().mockResolvedValue({
      Items: [
        {
          pk: "USER#user-123",
          sk: "CONNECTION#primary",
          userId: "user-123",
          connectionId: "primary",
          status: "active",
          scopes: ["gmail.readonly"],
          encryptedRefreshToken: "ciphertext",
          tokenCiphertextVersion: "kms:v1",
          tokenKmsKeyId: "alias/key",
          tokenUpdatedAt: "2026-03-17T10:00:00.000Z",
          createdAt: "2026-03-17T10:00:00.000Z",
          updatedAt: "2026-03-17T10:00:00.000Z",
        },
      ],
    });
    const repository = new DynamoDbGmailConnectionRepository({ send } as any, "gmail-connections", "status-index");

    await expect(repository.loadByUserId("user-123")).resolves.toEqual({
      userId: "user-123",
      connectionId: "primary",
      status: "active",
      gmailAddress: undefined,
      providerSubject: undefined,
      scopes: ["gmail.readonly"],
      encryptedRefreshToken: "ciphertext",
      tokenCiphertextVersion: "kms:v1",
      tokenKmsKeyId: "alias/key",
      tokenUpdatedAt: "2026-03-17T10:00:00.000Z",
      lastAuthenticatedAt: undefined,
      tokenError: undefined,
      revokedAt: undefined,
      createdAt: "2026-03-17T10:00:00.000Z",
      updatedAt: "2026-03-17T10:00:00.000Z",
    });
  });

  it("lists active connections through the status index", async () => {
    const send = vi.fn().mockResolvedValue({
      Items: [
        {
          pk: "USER#user-123",
          sk: "CONNECTION#primary",
          userId: "user-123",
          connectionId: "primary",
          status: "active",
          scopes: [],
          createdAt: "2026-03-17T10:00:00.000Z",
          updatedAt: "2026-03-17T10:00:00.000Z",
        },
      ],
    });
    const repository = new DynamoDbGmailConnectionRepository({ send } as any, "gmail-connections", "status-index");

    const records = await repository.listActiveConnections({ limit: 25 });

    expect(records).toHaveLength(1);
    const command = send.mock.calls[0][0];
    expect(command.input.IndexName).toBe("status-index");
    expect(command.input.ExpressionAttributeValues).toEqual({
      ":status": "STATUS#active",
    });
    expect(command.input.Limit).toBe(25);
  });

  it("records token errors as an error status", async () => {
    const send = vi.fn().mockResolvedValue({});
    const repository = new DynamoDbGmailConnectionRepository({ send } as any, "gmail-connections", "status-index");

    await repository.recordTokenError({
      userId: "user-123",
      error: {
        code: "invalid_grant",
        message: "Token revoked",
        occurredAt: "2026-03-17T12:00:00.000Z",
      },
    });

    const command = send.mock.calls[0][0];
    expect(command.input.Key).toEqual({
      pk: "USER#user-123",
      sk: "CONNECTION#primary",
    });
    expect(command.input.ExpressionAttributeValues).toMatchObject({
      ":status": "error",
      ":gsi1pk": "STATUS#error",
      ":tokenError": {
        code: "invalid_grant",
        message: "Token revoked",
        occurredAt: "2026-03-17T12:00:00.000Z",
      },
    });
  });

  it("updates status while keeping the status index in sync", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        Items: [
          {
            pk: "USER#user-123",
            sk: "CONNECTION#primary",
            userId: "user-123",
            connectionId: "primary",
            status: "error",
            tokenError: { code: "invalid_grant", occurredAt: "2026-03-17T12:00:00.000Z" },
            scopes: [],
            createdAt: "2026-03-17T10:00:00.000Z",
            updatedAt: "2026-03-17T12:00:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce({});
    const repository = new DynamoDbGmailConnectionRepository({ send } as any, "gmail-connections", "status-index");

    await repository.updateStatus({
      userId: "user-123",
      status: "active",
      changedAt: "2026-03-17T12:30:00.000Z",
    });

    const command = send.mock.calls[1][0];
    expect(command.input.ExpressionAttributeValues).toMatchObject({
      ":status": "active",
      ":gsi1pk": "STATUS#active",
      ":tokenError": null,
    });
  });

  it("clears stored token data while retaining reconnect metadata", async () => {
    const send = vi.fn().mockResolvedValue({});
    const repository = new DynamoDbGmailConnectionRepository({ send } as any, "gmail-connections", "status-index");

    await repository.clearTokenData({
      userId: "user-123",
      status: "revoked",
      revokedAt: "2026-03-17T12:30:00.000Z",
    });

    const command = send.mock.calls[0][0];
    expect(command.input.ExpressionAttributeValues).toMatchObject({
      ":status": "revoked",
      ":gsi1pk": "STATUS#revoked",
      ":encryptedRefreshToken": null,
      ":tokenCiphertextVersion": null,
      ":tokenKmsKeyId": null,
      ":tokenUpdatedAt": null,
    });
  });

  it("removes a connection item", async () => {
    const send = vi.fn().mockResolvedValue({});
    const repository = new DynamoDbGmailConnectionRepository({ send } as any, "gmail-connections", "status-index");

    await repository.remove("user-123");

    const command = send.mock.calls[0][0];
    expect(command.input.Key).toEqual({
      pk: "USER#user-123",
      sk: "CONNECTION#primary",
    });
  });
});
