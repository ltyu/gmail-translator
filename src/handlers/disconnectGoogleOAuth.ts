import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { KMSClient } from "@aws-sdk/client-kms";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DynamoDbGmailConnectionRepository } from "../repositories/dynamoDbGmailConnectionRepository.js";
import { JwtAuthenticatedAppUserProvider } from "../services/jwtAuthenticatedAppUserProvider.js";
import { IGmailConnectionRepository, IAuthenticatedAppUserProvider } from "../types.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
// KMS client is not needed for disconnect but kept for consistency with other handlers
const _kms = new KMSClient({});

type DisconnectGoogleOAuthConfig = {
  gmailConnectionsTable: string;
  gmailConnectionsStatusIndex: string;
};

type DisconnectGoogleOAuthDependencies = {
  authProvider: IAuthenticatedAppUserProvider<APIGatewayProxyEventV2WithJWTAuthorizer>;
  gmailConnectionRepository: IGmailConnectionRepository;
  getNow?: () => Date;
};

function getConfig(): DisconnectGoogleOAuthConfig {
  const gmailConnectionsTable = process.env.GMAIL_CONNECTIONS_TABLE;
  const gmailConnectionsStatusIndex = process.env.GMAIL_CONNECTIONS_STATUS_INDEX;

  if (!gmailConnectionsTable) {
    throw new Error("Missing required env var: GMAIL_CONNECTIONS_TABLE");
  }

  if (!gmailConnectionsStatusIndex) {
    throw new Error("Missing required env var: GMAIL_CONNECTIONS_STATUS_INDEX");
  }

  return { gmailConnectionsTable, gmailConnectionsStatusIndex };
}

export function createDisconnectGoogleOAuthHandler(
  dependencies: DisconnectGoogleOAuthDependencies,
) {
  const getNow = dependencies.getNow ?? (() => new Date());

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

    try {
      await dependencies.gmailConnectionRepository.clearRefreshToken({
        userId: authenticatedUser.userId,
        status: "revoked",
        occurredAt: getNow().toISOString(),
      });

      return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "Gmail connection disconnected." }),
      };
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
  };
}

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const config = getConfig();
  const defaultHandler = createDisconnectGoogleOAuthHandler({
    authProvider: new JwtAuthenticatedAppUserProvider(),
    gmailConnectionRepository: new DynamoDbGmailConnectionRepository(
      ddb,
      config.gmailConnectionsTable,
      config.gmailConnectionsStatusIndex,
    ),
  });

  return defaultHandler(event);
}
