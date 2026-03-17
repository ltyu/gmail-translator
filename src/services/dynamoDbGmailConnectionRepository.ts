import {
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  ClearGmailConnectionTokenDataInput,
  GmailConnectionRecord,
  GmailConnectionRepository,
  GmailConnectionStatus,
  ListGmailConnectionsInput,
  RecordGmailConnectionTokenErrorInput,
  UpdateGmailConnectionStatusInput,
  UpsertGmailConnectionInput,
} from "../types.js";

const DEFAULT_CONNECTION_ID = "primary";
const ENTITY_TYPE = "gmail-connection";

interface GmailConnectionItem {
  pk: string;
  sk: string;
  entityType: string;
  gsi1pk: string;
  gsi1sk: string;
  userId: string;
  connectionId: string;
  status: GmailConnectionStatus;
  gmailAddress?: string;
  providerSubject?: string;
  scopes?: string[];
  encryptedRefreshToken?: string;
  tokenCiphertextVersion?: string;
  tokenKmsKeyId?: string;
  tokenUpdatedAt?: string;
  lastAuthenticatedAt?: string;
  tokenError?: GmailConnectionRecord["tokenError"];
  revokedAt?: string;
  createdAt: string;
  updatedAt: string;
}

function getConnectionId(connectionId?: string): string {
  return connectionId ?? DEFAULT_CONNECTION_ID;
}

function buildKeys(userId: string, connectionId?: string): Pick<GmailConnectionItem, "pk" | "sk"> {
  const resolvedConnectionId = getConnectionId(connectionId);
  return {
    pk: `USER#${userId}`,
    sk: `CONNECTION#${resolvedConnectionId}`,
  };
}

function buildStatusKeys(status: GmailConnectionStatus, updatedAt: string, userId: string, connectionId: string) {
  return {
    gsi1pk: `STATUS#${status}`,
    gsi1sk: `UPDATED_AT#${updatedAt}#USER#${userId}#CONNECTION#${connectionId}`,
  };
}

function fromItem(item: GmailConnectionItem): GmailConnectionRecord {
  return {
    userId: item.userId,
    connectionId: item.connectionId,
    status: item.status,
    gmailAddress: item.gmailAddress,
    providerSubject: item.providerSubject,
    scopes: item.scopes ?? [],
    encryptedRefreshToken: item.encryptedRefreshToken,
    tokenCiphertextVersion: item.tokenCiphertextVersion,
    tokenKmsKeyId: item.tokenKmsKeyId,
    tokenUpdatedAt: item.tokenUpdatedAt,
    lastAuthenticatedAt: item.lastAuthenticatedAt,
    tokenError: item.tokenError,
    revokedAt: item.revokedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export class DynamoDbGmailConnectionRepository implements GmailConnectionRepository {
  constructor(
    private readonly ddb: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly statusIndexName: string,
  ) {}

  async upsert(input: UpsertGmailConnectionInput): Promise<GmailConnectionRecord> {
    const existing = await this.loadByUserId(input.userId);
    const connectionId = getConnectionId(input.connectionId);
    const now = input.lastAuthenticatedAt ?? input.tokenUpdatedAt;
    const status = input.status ?? "active";
    const createdAt = existing?.createdAt ?? now;
    const item: GmailConnectionItem = {
      ...buildKeys(input.userId, connectionId),
      ...buildStatusKeys(status, now, input.userId, connectionId),
      entityType: ENTITY_TYPE,
      userId: input.userId,
      connectionId,
      status,
      gmailAddress: input.gmailAddress,
      providerSubject: input.providerSubject,
      scopes: input.scopes ?? existing?.scopes ?? [],
      encryptedRefreshToken: input.encryptedRefreshToken,
      tokenCiphertextVersion: input.tokenCiphertextVersion,
      tokenKmsKeyId: input.tokenKmsKeyId,
      tokenUpdatedAt: input.tokenUpdatedAt,
      lastAuthenticatedAt: input.lastAuthenticatedAt ?? existing?.lastAuthenticatedAt,
      tokenError: undefined,
      revokedAt: status === "revoked" ? now : undefined,
      createdAt,
      updatedAt: now,
    };

    await this.ddb.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
      }),
    );

    return fromItem(item);
  }

  async loadByUserId(userId: string): Promise<GmailConnectionRecord | null> {
    const response = await this.ddb.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: {
          ":pk": buildKeys(userId).pk,
        },
        Limit: 1,
      }),
    );

    const item = response.Items?.[0] as GmailConnectionItem | undefined;
    return item ? fromItem(item) : null;
  }

  async listActiveConnections(input: ListGmailConnectionsInput = {}): Promise<GmailConnectionRecord[]> {
    const response = await this.ddb.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: this.statusIndexName,
        KeyConditionExpression: "gsi1pk = :status",
        ExpressionAttributeValues: {
          ":status": "STATUS#active",
        },
        Limit: input.limit,
      }),
    );

    return (response.Items ?? []).map((item) => fromItem(item as GmailConnectionItem));
  }

  async updateStatus(input: UpdateGmailConnectionStatusInput): Promise<void> {
    const connection = await this.getRequiredConnection(input.userId);
    const connectionId = getConnectionId(input.connectionId);
    const updatedAt = input.changedAt ?? input.revokedAt ?? new Date().toISOString();
    const statusKeys = buildStatusKeys(input.status, updatedAt, input.userId, connectionId);

    await this.ddb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: buildKeys(input.userId, connectionId),
        UpdateExpression: [
          "SET #status = :status",
          "updatedAt = :updatedAt",
          "gsi1pk = :gsi1pk",
          "gsi1sk = :gsi1sk",
          "revokedAt = :revokedAt",
          "tokenError = :tokenError",
        ].join(", "),
        ExpressionAttributeNames: {
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":status": input.status,
          ":updatedAt": updatedAt,
          ":gsi1pk": statusKeys.gsi1pk,
          ":gsi1sk": statusKeys.gsi1sk,
          ":revokedAt": input.status === "revoked" ? input.revokedAt ?? updatedAt : null,
          ":tokenError": input.status === "error" ? connection.tokenError ?? null : null,
        },
      }),
    );
  }

  async recordTokenError(input: RecordGmailConnectionTokenErrorInput): Promise<void> {
    const connectionId = getConnectionId(input.connectionId);
    const status = input.status ?? "error";
    const statusKeys = buildStatusKeys(status, input.error.occurredAt, input.userId, connectionId);

    await this.ddb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: buildKeys(input.userId, connectionId),
        UpdateExpression: [
          "SET #status = :status",
          "updatedAt = :updatedAt",
          "gsi1pk = :gsi1pk",
          "gsi1sk = :gsi1sk",
          "tokenError = :tokenError",
        ].join(", "),
        ExpressionAttributeNames: {
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":status": status,
          ":updatedAt": input.error.occurredAt,
          ":gsi1pk": statusKeys.gsi1pk,
          ":gsi1sk": statusKeys.gsi1sk,
          ":tokenError": input.error,
        },
      }),
    );
  }

  async clearTokenData(input: ClearGmailConnectionTokenDataInput): Promise<void> {
    const connectionId = getConnectionId(input.connectionId);
    const updatedAt = input.changedAt ?? input.revokedAt ?? new Date().toISOString();
    const status = input.status ?? "revoked";
    const statusKeys = buildStatusKeys(status, updatedAt, input.userId, connectionId);

    await this.ddb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: buildKeys(input.userId, connectionId),
        UpdateExpression: [
          "SET #status = :status",
          "updatedAt = :updatedAt",
          "gsi1pk = :gsi1pk",
          "gsi1sk = :gsi1sk",
          "revokedAt = :revokedAt",
          "encryptedRefreshToken = :encryptedRefreshToken",
          "tokenCiphertextVersion = :tokenCiphertextVersion",
          "tokenKmsKeyId = :tokenKmsKeyId",
          "tokenUpdatedAt = :tokenUpdatedAt",
          "tokenError = :tokenError",
        ].join(", "),
        ExpressionAttributeNames: {
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":status": status,
          ":updatedAt": updatedAt,
          ":gsi1pk": statusKeys.gsi1pk,
          ":gsi1sk": statusKeys.gsi1sk,
          ":revokedAt": status === "revoked" ? input.revokedAt ?? updatedAt : null,
          ":encryptedRefreshToken": null,
          ":tokenCiphertextVersion": null,
          ":tokenKmsKeyId": null,
          ":tokenUpdatedAt": null,
          ":tokenError": null,
        },
      }),
    );
  }

  async remove(userId: string, connectionId?: string): Promise<void> {
    await this.ddb.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: buildKeys(userId, connectionId),
      }),
    );
  }

  private async getRequiredConnection(userId: string): Promise<GmailConnectionRecord> {
    const connection = await this.loadByUserId(userId);

    if (!connection) {
      throw new Error(`Missing Gmail connection for user ${userId}`);
    }

    return connection;
  }
}
