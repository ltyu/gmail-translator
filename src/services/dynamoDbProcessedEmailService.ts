import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ProcessedEmailService } from "../types.js";

export class DynamoDbProcessedEmailService implements ProcessedEmailService {
  constructor(
    private readonly ddb: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async isProcessed(emailId: string): Promise<boolean> {
    const response = await this.ddb.send(
      new GetCommand({ TableName: this.tableName, Key: { email_id: emailId } }),
    );
    return !!response.Item;
  }

  async markProcessed(emailId: string): Promise<void> {
    const ttl = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
    await this.ddb.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { email_id: emailId, ttl, processed_at: new Date().toISOString() },
      }),
    );
  }
}
