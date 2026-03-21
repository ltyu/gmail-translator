import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { KMSClient } from "@aws-sdk/client-kms";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DynamoDbGmailConnectionRepository } from "../repositories/dynamoDbGmailConnectionRepository.js";
import { GoogleOAuthClient } from "../services/googleOAuthClient.js";
import { JwtAuthenticatedAppUserProvider } from "../services/jwtAuthenticatedAppUserProvider.js";
import { KmsGmailTokenEncryptionService } from "../services/kmsGmailTokenEncryptionService.js";
import {
  IAuthenticatedAppUserProvider,
  IGmailConnectionRepository,
  IGmailTokenEncryptionService,
  IGoogleOAuthClient,
} from "../types.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const kms = new KMSClient({});
const DISCONNECT_GOOGLE_OAUTH_SCOPE = "gmail:disconnect";

type DisconnectGoogleOAuthConfig = {
  gmailConnectionsTable: string;
  gmailConnectionsStatusIndex: string;
  gmailTokenKmsKeyId: string;
};

type DisconnectGoogleOAuthDependencies = {
  authProvider: IAuthenticatedAppUserProvider<APIGatewayProxyEventV2WithJWTAuthorizer>;
  gmailConnectionRepository: IGmailConnectionRepository;
  tokenEncryptionService: IGmailTokenEncryptionService;
  googleOAuthClient: IGoogleOAuthClient;
  getNow?: () => Date;
  logger?: Pick<Console, "error">;
};

function getConfig(): DisconnectGoogleOAuthConfig {
  const gmailConnectionsTable = process.env.GMAIL_CONNECTIONS_TABLE;
  const gmailConnectionsStatusIndex = process.env.GMAIL_CONNECTIONS_STATUS_INDEX;
  const gmailTokenKmsKeyId = process.env.GMAIL_TOKEN_KMS_KEY_ID;

  if (!gmailConnectionsTable) {
    throw new Error("Missing required env var: GMAIL_CONNECTIONS_TABLE");
  }

  if (!gmailConnectionsStatusIndex) {
    throw new Error("Missing required env var: GMAIL_CONNECTIONS_STATUS_INDEX");
  }

  if (!gmailTokenKmsKeyId) {
    throw new Error("Missing required env var: GMAIL_TOKEN_KMS_KEY_ID");
  }

  return { gmailConnectionsTable, gmailConnectionsStatusIndex, gmailTokenKmsKeyId };
}

export function createDisconnectGoogleOAuthHandler(
  dependencies: DisconnectGoogleOAuthDependencies,
) {
  const getNow = dependencies.getNow ?? (() => new Date());
  const logger = dependencies.logger ?? console;

  return async function disconnectGoogleOAuth(
    event: APIGatewayProxyEventV2WithJWTAuthorizer,
  ): Promise<APIGatewayProxyStructuredResultV2> {
    const authenticatedUser = await dependencies.authProvider.getAuthenticatedUser(event);

    if (!authenticatedUser) {
      return {
        statusCode: 401,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "Authentication required." }),
      };
    }

    const connection = await dependencies.gmailConnectionRepository.loadPrimaryByUserId(
      authenticatedUser.userId,
    );

    if (!connection) {
      return {
        statusCode: 404,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "No Gmail connection found." }),
      };
    }

    let revokedAtGoogle = true;

    if (connection.encryptedRefreshToken) {
      try {
        const refreshToken = await dependencies.tokenEncryptionService.decryptRefreshToken(
          connection.encryptedRefreshToken,
          {
            userId: connection.userId,
            connectionId: connection.connectionId,
          },
        );

        await dependencies.googleOAuthClient.revokeToken(refreshToken);
      } catch (error) {
        revokedAtGoogle = false;
        logger.error("Failed to revoke Google OAuth token", {
          userId: authenticatedUser.userId,
          error: error instanceof Error ? error.message : "unknown_error",
        });
      }
    }

    try {
      await dependencies.gmailConnectionRepository.clearRefreshToken({
        userId: authenticatedUser.userId,
        status: "revoked",
        occurredAt: getNow().toISOString(),
      });
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        return {
          statusCode: 404,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: "No Gmail connection found." }),
        };
      }
      throw error;
    }

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        revokedAtGoogle
          ? {
              message: "Gmail connection disconnected.",
              revokedAtGoogle: true,
            }
          : {
              message:
                "Gmail connection disconnected locally, but Google revocation failed. Revoke access in Google account settings if needed.",
              revokedAtGoogle: false,
            },
      ),
    };
  };
}

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const config = getConfig();
  const defaultHandler = createDisconnectGoogleOAuthHandler({
    authProvider: new JwtAuthenticatedAppUserProvider([DISCONNECT_GOOGLE_OAUTH_SCOPE]),
    gmailConnectionRepository: new DynamoDbGmailConnectionRepository(
      ddb,
      config.gmailConnectionsTable,
      config.gmailConnectionsStatusIndex,
    ),
    tokenEncryptionService: new KmsGmailTokenEncryptionService(kms, config.gmailTokenKmsKeyId),
    googleOAuthClient: new GoogleOAuthClient(),
  });

  return defaultHandler(event);
}
