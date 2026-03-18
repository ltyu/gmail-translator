import { DeleteCommand, DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { CreateOAuthStateInput, OAuthStateRecord, IOAuthStateRepository } from "../types.js";

type OAuthStateItem = {
  state: string;
  userId: string;
  redirectUri: string;
  createdAt: string;
  expiresAt: string;
  ttl: number;
};

function toTtl(expiresAt: string): number {
  return Math.floor(new Date(expiresAt).getTime() / 1000);
}

export class DynamoDbOAuthStateRepository implements IOAuthStateRepository {
  constructor(
    private readonly ddb: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async create(input: CreateOAuthStateInput): Promise<void> {
    const item: OAuthStateItem = {
      state: input.state,
      userId: input.userId,
      redirectUri: input.redirectUri,
      createdAt: input.createdAt,
      expiresAt: input.expiresAt,
      ttl: toTtl(input.expiresAt),
    };

    await this.ddb.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
        ConditionExpression: "attribute_not_exists(#state)",
        ExpressionAttributeNames: {
          "#state": "state",
        },
      }),
    );
  }

  async consume(state: string): Promise<OAuthStateRecord | null> {
    const response = await this.ddb.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { state },
        ReturnValues: "ALL_OLD",
      }),
    );

    const item = response.Attributes as OAuthStateItem | undefined;

    if (!item) {
      return null;
    }

    return {
      state: item.state,
      userId: item.userId,
      redirectUri: item.redirectUri,
      createdAt: item.createdAt,
      expiresAt: item.expiresAt,
    };
  }
}
