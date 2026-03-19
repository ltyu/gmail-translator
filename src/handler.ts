import { ScheduledEvent } from "aws-lambda";
import Anthropic from "@anthropic-ai/sdk";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { KMSClient } from "@aws-sdk/client-kms";
import { SSMClient } from "@aws-sdk/client-ssm";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DynamoDbGmailConnectionRepository } from "./repositories/dynamoDbGmailConnectionRepository.js";
import { DynamoDbProcessedEmailRepository } from "./repositories/dynamoDbProcessedEmailRepository.js";
import { GmailMessageService } from "./services/gmailMessageService.js";
import { KmsGmailTokenEncryptionService } from "./services/kmsGmailTokenEncryptionService.js";
import { ParameterStoreService } from "./services/parameterStore.js";
import { AnthropicTranslationService } from "./services/translatorService.js";
import {
  AppConfig,
  GmailConnectionRecord,
  IGmailConnectionRepository,
  IGmailService,
  IGmailTokenEncryptionService,
  IProcessedEmailRepository,
  ITranslationService,
} from "./types.js";
import { buildGmailClient } from "./utils/buildGmailClient.js";

const ssm = new SSMClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const kms = new KMSClient({});

function getConfig(): AppConfig {
  const processedEmailTable = process.env.PROCESSED_EMAILS_TABLE ?? process.env.DYNAMODB_TABLE;
  const appSecretsPrefix = process.env.APP_SECRETS_SSM_PREFIX ?? process.env.SSM_PREFIX;
  const gmailConnectionsTable = process.env.GMAIL_CONNECTIONS_TABLE;
  const gmailConnectionsStatusIndex = process.env.GMAIL_CONNECTIONS_STATUS_INDEX;
  const gmailTokenKmsKeyId = process.env.GMAIL_TOKEN_KMS_KEY_ID;

  if (!processedEmailTable) {
    throw new Error("Missing required env var: PROCESSED_EMAILS_TABLE");
  }

  if (!appSecretsPrefix) {
    throw new Error("Missing required env var: APP_SECRETS_SSM_PREFIX");
  }

  if (!gmailConnectionsTable) {
    throw new Error("Missing required env var: GMAIL_CONNECTIONS_TABLE");
  }

  if (!gmailConnectionsStatusIndex) {
    throw new Error("Missing required env var: GMAIL_CONNECTIONS_STATUS_INDEX");
  }

  if (!gmailTokenKmsKeyId) {
    throw new Error("Missing required env var: GMAIL_TOKEN_KMS_KEY_ID");
  }

  return {
    processedEmailTable,
    appSecretsPrefix,
    gmailConnectionsTable,
    gmailConnectionsStatusIndex,
    gmailTokenKmsKeyId,
  };
}

function createParameterStore(config: AppConfig): ParameterStoreService {
  return new ParameterStoreService(ssm, config.appSecretsPrefix);
}

function isPermanentGmailAuthError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();

  return (
    message.includes("invalid_grant") ||
    message.includes("invalid credentials")
  );
}

function createConnectionLogger(
  connection: GmailConnectionRecord,
  logger: Pick<Console, "log">,
): Pick<Console, "log"> {
  const prefix = `[user:${connection.userId}]`;

  return {
    log(message: string) {
      logger.log(`${prefix} ${message}`);
    },
  };
}

function createScopedProcessedEmailRepository(
  repository: IProcessedEmailRepository,
  connection: GmailConnectionRecord,
): IProcessedEmailRepository {
  function scopedMessageId(emailId: string): string {
    return `${connection.userId}:${emailId}`;
  }

  return {
    isProcessed(emailId: string) {
      return repository.isProcessed(scopedMessageId(emailId));
    },
    markProcessed(emailId: string) {
      return repository.markProcessed(scopedMessageId(emailId));
    },
  };
}

export async function processActiveConnections(
  connections: GmailConnectionRecord[],
  gmailConnectionRepository: IGmailConnectionRepository,
  tokenEncryptionService: IGmailTokenEncryptionService,
  appSecrets: { gmailOAuthClientId: string; gmailOAuthClientSecret: string },
  translationService: ITranslationService,
  processedEmailRepository: IProcessedEmailRepository,
  logger: Pick<Console, "log"> = console,
  createGmailService: (refreshToken: string) => IGmailService = (refreshToken: string) =>
    new GmailMessageService(
      buildGmailClient(
        {
          clientId: appSecrets.gmailOAuthClientId,
          clientSecret: appSecrets.gmailOAuthClientSecret,
        },
        refreshToken,
      ),
    ),
): Promise<void> {
  for (const connection of connections) {
    const connectionLogger = createConnectionLogger(connection, logger);

    if (!connection.encryptedRefreshToken) {
      connectionLogger.log("Skipping connection without stored refresh token");
      continue;
    }

    try {
      const refreshToken = await tokenEncryptionService.decryptRefreshToken(
        connection.encryptedRefreshToken,
        { userId: connection.userId, connectionId: connection.connectionId },
      );
      const gmailService = createGmailService(refreshToken);

      await processInbox(
        gmailService,
        translationService,
        createScopedProcessedEmailRepository(processedEmailRepository, connection),
        connectionLogger,
      );
    } catch (error) {
      connectionLogger.log(
        `Failed to process connection: ${error instanceof Error ? error.message : "unknown error"}`,
      );

      if (isPermanentGmailAuthError(error)) {
        await gmailConnectionRepository.markError(connection.userId, new Date().toISOString());
        connectionLogger.log("Marked connection as error due to permanent Gmail auth failure");
      }
    }
  }
}

export async function processInbox(
  gmailService: IGmailService,
  translationService: ITranslationService,
  processedEmailRepository: IProcessedEmailRepository,
  logger: Pick<Console, "log"> = console,
): Promise<void> {
  const myEmail = await gmailService.getAuthenticatedEmail();
  const tenMinAgo = Math.floor((Date.now() - 10 * 60 * 1000) / 1000);
  const messages = await gmailService.listRecentInboxMessages(tenMinAgo);

  logger.log(`Found ${messages.length} recent messages`);

  for (const message of messages) {
    if (await processedEmailRepository.isProcessed(message.id)) {
      logger.log(`Skipping already processed: ${message.id}`);
      continue;
    }

    const fullMessage = await gmailService.getMessage(message.id);
    logger.log(`Processing: "${fullMessage.subject}" from ${fullMessage.from}`);

    if (!fullMessage.bodyText.trim()) {
      logger.log(`Empty body, skipping: ${message.id}`);
      await processedEmailRepository.markProcessed(message.id);
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
    await processedEmailRepository.markProcessed(message.id);
  }

  logger.log("Done");
}

export async function handler(_event: ScheduledEvent): Promise<void> {
  const config = getConfig();
  const params = await createParameterStore(config).loadParams();
  const gmailConnectionRepository = new DynamoDbGmailConnectionRepository(
    ddb,
    config.gmailConnectionsTable!,
    config.gmailConnectionsStatusIndex!,
  );
  const tokenEncryptionService = new KmsGmailTokenEncryptionService(
    kms,
    config.gmailTokenKmsKeyId!,
  );
  const connections = await gmailConnectionRepository.listActive();
  const translationService = new AnthropicTranslationService(
    new Anthropic({ apiKey: params.anthropicApiKey }),
  );
  const processedEmailRepository = new DynamoDbProcessedEmailRepository(
    ddb,
    config.processedEmailTable,
  );

  await processActiveConnections(
    connections,
    gmailConnectionRepository,
    tokenEncryptionService,
    {
      gmailOAuthClientId: params.gmailOAuthClientId,
      gmailOAuthClientSecret: params.gmailOAuthClientSecret,
    },
    translationService,
    processedEmailRepository,
  );
}
