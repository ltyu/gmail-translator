import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { CreateOAuthStateInput, OAuthStateRepository } from "../types.js";

interface OAuthStateItem {
  state: string;
  userId: string;
  redirectUri: string;
  createdAt: string;
  expiresAt: string;
  ttl: number;
}

function toTtl(expiresAt: string): number {
  return Math.floor(new Date(expiresAt).getTime() / 1000);
}

export class DynamoDbOAuthStateRepository implements OAuthStateRepository {
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
}
