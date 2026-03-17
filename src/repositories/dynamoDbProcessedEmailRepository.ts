import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ProcessedEmailRepository, ProcessedEmailScope } from "../types.js";

function buildConnectionKey(scope: ProcessedEmailScope): string {
  return `${scope.userId}:${scope.connectionId}`;
}

export class DynamoDbProcessedEmailRepository implements ProcessedEmailRepository {
  constructor(
    private readonly ddb: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async isProcessed(scope: ProcessedEmailScope, emailId: string): Promise<boolean> {
    const response = await this.ddb.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { connection_id: buildConnectionKey(scope), email_id: emailId },
      }),
    );
    return !!response.Item;
  }

  async markProcessed(scope: ProcessedEmailScope, emailId: string): Promise<void> {
    const ttl = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
    await this.ddb.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          connection_id: buildConnectionKey(scope),
          email_id: emailId,
          ttl,
          processed_at: new Date().toISOString(),
        },
      }),
    );
  }
}
