import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  IClearPrimaryGmailRefreshTokenInput,
  IGmailConnectionRecord,
  IGmailConnectionRepository,
  GmailConnectionStatus,
  PRIMARY_GMAIL_CONNECTION_ID,
  IUpsertPrimaryGmailConnectionInput,
} from "../types.js";

type GmailConnectionItem = {
  // Partition key set directly to the owning app user id.
  pk: string;
  // Sort key for the primary Gmail connection record.
  sk: string;
  // Status value used as the GSI partition key.
  gsi1pk: string;
  // Last update timestamp used as the GSI sort key.
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
};

function buildKeys(userId: string): Pick<GmailConnectionItem, "pk" | "sk"> {
  return {
    pk: userId,
    sk: PRIMARY_GMAIL_CONNECTION_ID,
  };
}

function buildStatusKeys(status: GmailConnectionStatus, updatedAt: string) {
  return {
    gsi1pk: status,
    gsi1sk: updatedAt,
  };
}

function fromItem(item: GmailConnectionItem): IGmailConnectionRecord {
  return {
    userId: item.pk,
    connectionId: PRIMARY_GMAIL_CONNECTION_ID,
    status: item.status,
    googleSub: item.googleSub,
    gmailAddress: item.gmailAddress,
    encryptedRefreshToken: item.encryptedRefreshToken,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export class DynamoDbGmailConnectionRepository implements IGmailConnectionRepository {
  constructor(
    private readonly ddb: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly statusIndexName: string,
  ) {}

  async upsertPrimary(input: IUpsertPrimaryGmailConnectionInput): Promise<IGmailConnectionRecord> {
    const existing = await this.loadPrimaryByUserId(input.userId);
    const status = input.status ?? "active";
    const item: GmailConnectionItem = {
      ...buildKeys(input.userId),
      ...buildStatusKeys(status, input.occurredAt),
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

  async loadPrimaryByUserId(userId: string): Promise<IGmailConnectionRecord | null> {
    const response = await this.ddb.send(
      new GetCommand({
        TableName: this.tableName,
        Key: buildKeys(userId),
      }),
    );

    const item = response.Item as GmailConnectionItem | undefined;
    return item ? fromItem(item) : null;
  }

  async listActive(limit?: number): Promise<IGmailConnectionRecord[]> {
    const records: IGmailConnectionRecord[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const response = await this.ddb.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: this.statusIndexName,
          KeyConditionExpression: "gsi1pk = :status",
          ExpressionAttributeValues: {
            ":status": "active",
          },
          Limit: limit,
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );

      records.push(...(response.Items ?? []).map((item) => fromItem(item as GmailConnectionItem)));
      exclusiveStartKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (exclusiveStartKey && limit === undefined);

    return records;
  }

  async markRevoked(userId: string, occurredAt: string): Promise<void> {
    await this.updateConnectionStatus(userId, "revoked", occurredAt);
  }

  async markError(userId: string, occurredAt: string): Promise<void> {
    await this.updateConnectionStatus(userId, "error", occurredAt);
  }

  async clearRefreshToken(input: IClearPrimaryGmailRefreshTokenInput): Promise<void> {
    const status = input.status ?? "revoked";
    const statusKeys = buildStatusKeys(status, input.occurredAt);

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
    const statusKeys = buildStatusKeys(status, occurredAt);

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
