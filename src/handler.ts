import { ScheduledEvent } from "aws-lambda";
import Anthropic from "@anthropic-ai/sdk";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SSMClient } from "@aws-sdk/client-ssm";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DynamoDbProcessedEmailService } from "./services/dynamoDbProcessedEmailService.js";
import { GmailMessageService } from "./services/gmailMessageService.js";
import { ParameterStoreService } from "./services/parameterStore.js";
import { AnthropicTranslationService } from "./services/translatorService.js";
import {
  AppConfig,
  GmailService,
  ProcessedEmailService,
  TranslationService,
} from "./types.js";
import { buildGmailClient } from "./utils/buildGmailClient.js";

const ssm = new SSMClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function getConfig(): AppConfig {
  const dynamoDbTable = process.env.DYNAMODB_TABLE;
  const ssmPrefix = process.env.SSM_PREFIX;

  if (!dynamoDbTable) {
    throw new Error("Missing required env var: DYNAMODB_TABLE");
  }

  if (!ssmPrefix) {
    throw new Error("Missing required env var: SSM_PREFIX");
  }

  return { dynamoDbTable, ssmPrefix };
}

let parameterStore: ParameterStoreService | null = null;

function getParameterStore(config: AppConfig): ParameterStoreService {
  if (!parameterStore) {
    parameterStore = new ParameterStoreService(ssm, config.ssmPrefix);
  }

  return parameterStore;
}

export async function processInbox(
  gmailService: GmailService,
  translationService: TranslationService,
  processedEmailService: ProcessedEmailService,
  logger: Pick<Console, "log"> = console,
): Promise<void> {
  const myEmail = await gmailService.getAuthenticatedEmail();
  const tenMinAgo = Math.floor((Date.now() - 10 * 60 * 1000) / 1000);
  const messages = await gmailService.listRecentInboxMessages(tenMinAgo);

  logger.log(`Found ${messages.length} recent messages`);

  for (const message of messages) {
    if (await processedEmailService.isProcessed(message.id)) {
      logger.log(`Skipping already processed: ${message.id}`);
      continue;
    }

    const fullMessage = await gmailService.getMessage(message.id);
    logger.log(`Processing: "${fullMessage.subject}" from ${fullMessage.from}`);

    if (!fullMessage.bodyText.trim()) {
      logger.log(`Empty body, skipping: ${message.id}`);
      await processedEmailService.markProcessed(message.id);
      continue;
    }

    const translation = await translationService.translateText(fullMessage.bodyText);

    await gmailService.sendReply({
      to: myEmail,
      subject: fullMessage.subject,
      messageId: fullMessage.messageId,
      threadId: fullMessage.threadId,
      translation,
      originalText: fullMessage.bodyText,
    });

    logger.log(`Replied with translation for: "${fullMessage.subject}"`);
    await processedEmailService.markProcessed(message.id);
  }

  logger.log("Done");
}

export async function handler(_event: ScheduledEvent): Promise<void> {
  const config = getConfig();
  const params = await getParameterStore(config).loadParams();
  const gmailService = new GmailMessageService(buildGmailClient(params));
  const translationService = new AnthropicTranslationService(
    new Anthropic({ apiKey: params.anthropicApiKey }),
  );
  const processedEmailService = new DynamoDbProcessedEmailService(
    ddb,
    config.dynamoDbTable,
  );

  await processInbox(gmailService, translationService, processedEmailService);
}
