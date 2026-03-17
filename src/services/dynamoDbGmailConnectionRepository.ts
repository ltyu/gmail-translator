import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  ClearPrimaryGmailRefreshTokenInput,
  GmailConnectionRecord,
  GmailConnectionRepository,
  GmailConnectionStatus,
  PRIMARY_GMAIL_CONNECTION_ID,
  UpsertPrimaryGmailConnectionInput,
} from "../types.js";

interface GmailConnectionItem {
  // Partition key for all Gmail connection records owned by one app user.
  pk: string;
  // Sort key for the primary Gmail connection record.
  sk: string;
  // Status-partitioned GSI key used to list active connections.
  gsi1pk: string;
  // GSI sort key used to order connections by last update time.
  gsi1sk: string;
  // Current lifecycle state for worker eligibility.
  status: GmailConnectionStatus;
  // Stable Google account subject from OAuth identity data.
  googleSub: string;
  // Human-readable Gmail address for UI and debugging.
  gmailAddress?: string;
  // KMS-encrypted Gmail refresh token used by backend workers.
  encryptedRefreshToken?: string;
  // When the connection record was first created.
  createdAt: string;
  // When the connection record last changed.
  updatedAt: string;
}

function buildKeys(userId: string): Pick<GmailConnectionItem, "pk" | "sk"> {
  return {
    pk: `USER#${userId}`,
    sk: `CONNECTION#${PRIMARY_GMAIL_CONNECTION_ID}`,
  };
}

function buildStatusKeys(status: GmailConnectionStatus, updatedAt: string, userId: string) {
  return {
    gsi1pk: `STATUS#${status}`,
    gsi1sk: `UPDATED_AT#${updatedAt}#USER#${userId}`,
  };
}

function parseUserId(pk: string): string {
  return pk.replace(/^USER#/, "");
}

function fromItem(item: GmailConnectionItem): GmailConnectionRecord {
  return {
    userId: parseUserId(item.pk),
    connectionId: PRIMARY_GMAIL_CONNECTION_ID,
    status: item.status,
    googleSub: item.googleSub,
    gmailAddress: item.gmailAddress,
    encryptedRefreshToken: item.encryptedRefreshToken,
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

  async upsertPrimary(input: UpsertPrimaryGmailConnectionInput): Promise<GmailConnectionRecord> {
    const existing = await this.loadPrimaryByUserId(input.userId);
    const status = input.status ?? "active";
    const item: GmailConnectionItem = {
      ...buildKeys(input.userId),
      ...buildStatusKeys(status, input.occurredAt, input.userId),
      status,
      googleSub: input.googleSub,
      gmailAddress: input.gmailAddress,
      encryptedRefreshToken: input.encryptedRefreshToken,
      createdAt: existing?.createdAt ?? input.occurredAt,
      updatedAt: input.occurredAt,
    };

    await this.ddb.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
      }),
    );

    return fromItem(item);
  }

  async loadPrimaryByUserId(userId: string): Promise<GmailConnectionRecord | null> {
    const response = await this.ddb.send(
      new GetCommand({
        TableName: this.tableName,
        Key: buildKeys(userId),
      }),
    );

    const item = response.Item as GmailConnectionItem | undefined;
    return item ? fromItem(item) : null;
  }

  async listActive(limit?: number): Promise<GmailConnectionRecord[]> {
    const response = await this.ddb.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: this.statusIndexName,
        KeyConditionExpression: "gsi1pk = :status",
        ExpressionAttributeValues: {
          ":status": "STATUS#active",
        },
        Limit: limit,
      }),
    );

    return (response.Items ?? []).map((item) => fromItem(item as GmailConnectionItem));
  }

  async markRevoked(userId: string, occurredAt: string): Promise<void> {
    await this.updateConnectionStatus(userId, "revoked", occurredAt);
  }

  async markError(userId: string, occurredAt: string): Promise<void> {
    await this.updateConnectionStatus(userId, "error", occurredAt);
  }

  async clearRefreshToken(input: ClearPrimaryGmailRefreshTokenInput): Promise<void> {
    const status = input.status ?? "revoked";
    const statusKeys = buildStatusKeys(status, input.occurredAt, input.userId);

    await this.ddb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: buildKeys(input.userId),
        ConditionExpression: "attribute_exists(pk) AND attribute_exists(sk)",
        UpdateExpression: [
          "SET #status = :status",
          "updatedAt = :updatedAt",
          "gsi1pk = :gsi1pk",
          "gsi1sk = :gsi1sk",
          "encryptedRefreshToken = :encryptedRefreshToken",
        ].join(", "),
        ExpressionAttributeNames: {
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":status": status,
          ":updatedAt": input.occurredAt,
          ":gsi1pk": statusKeys.gsi1pk,
          ":gsi1sk": statusKeys.gsi1sk,
          ":encryptedRefreshToken": null,
        },
      }),
    );
  }

  async removePrimary(userId: string): Promise<void> {
    await this.ddb.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: buildKeys(userId),
      }),
    );
  }

  private async updateConnectionStatus(
    userId: string,
    status: Extract<GmailConnectionStatus, "revoked" | "error">,
    occurredAt: string,
  ): Promise<void> {
    const statusKeys = buildStatusKeys(status, occurredAt, userId);

    await this.ddb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: buildKeys(userId),
        ConditionExpression: "attribute_exists(pk) AND attribute_exists(sk)",
        UpdateExpression: [
          "SET #status = :status",
          "updatedAt = :updatedAt",
          "gsi1pk = :gsi1pk",
          "gsi1sk = :gsi1sk",
        ].join(", "),
        ExpressionAttributeNames: {
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":status": status,
          ":updatedAt": occurredAt,
          ":gsi1pk": statusKeys.gsi1pk,
          ":gsi1sk": statusKeys.gsi1sk,
        },
      }),
    );
  }
}
