import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { KMSClient } from "@aws-sdk/client-kms";
import { SSMClient } from "@aws-sdk/client-ssm";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DynamoDbGmailConnectionRepository } from "../repositories/dynamoDbGmailConnectionRepository.js";
import { DynamoDbOAuthStateRepository } from "../repositories/dynamoDbOAuthStateRepository.js";
import { GoogleOAuthClient } from "../services/googleOAuthClient.js";
import { KmsGmailTokenEncryptionService } from "../services/kmsGmailTokenEncryptionService.js";
import { ParameterStoreService } from "../services/parameterStore.js";
import {
  IGmailConnectionRepository,
  IGmailTokenEncryptionService,
  IGoogleOAuthClient,
  IOAuthStateRepository,
} from "../types.js";


const ssm = new SSMClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const kms = new KMSClient({});

type GoogleOAuthCallbackConfig = {
  appSecretsPrefix: string;
  oauthStateTable: string;
  gmailConnectionsTable: string;
  gmailConnectionsStatusIndex: string;
  gmailTokenKmsKeyId: string;
  successRedirectUrl: string;
  failureRedirectUrl: string;
};

type GoogleOAuthCallbackDependencies = {
  parameterStore: ParameterStoreService;
  oauthStateRepository: IOAuthStateRepository;
  gmailConnectionRepository: IGmailConnectionRepository;
  tokenEncryptionService: IGmailTokenEncryptionService;
  googleOAuthClient: IGoogleOAuthClient;
  getNow?: () => Date;
  logger?: Pick<Console, "error">;
};

function getConfig(): GoogleOAuthCallbackConfig {
  const appSecretsPrefix = process.env.APP_SECRETS_SSM_PREFIX;
  const oauthStateTable = process.env.GOOGLE_OAUTH_STATES_TABLE;
  const gmailConnectionsTable = process.env.GMAIL_CONNECTIONS_TABLE;
  const gmailConnectionsStatusIndex = process.env.GMAIL_CONNECTIONS_STATUS_INDEX;
  const gmailTokenKmsKeyId = process.env.GMAIL_TOKEN_KMS_KEY_ID;
  const successRedirectUrl = process.env.GMAIL_CONNECTION_SUCCESS_REDIRECT_URL;
  const failureRedirectUrl = process.env.GMAIL_CONNECTION_FAILURE_REDIRECT_URL;

  if (!appSecretsPrefix) {
    throw new Error("Missing required env var: APP_SECRETS_SSM_PREFIX");
  }

  if (!oauthStateTable) {
    throw new Error("Missing required env var: GOOGLE_OAUTH_STATES_TABLE");
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

  if (!successRedirectUrl) {
    throw new Error("Missing required env var: GMAIL_CONNECTION_SUCCESS_REDIRECT_URL");
  }

  if (!failureRedirectUrl) {
    throw new Error("Missing required env var: GMAIL_CONNECTION_FAILURE_REDIRECT_URL");
  }

  return {
    appSecretsPrefix,
    oauthStateTable,
    gmailConnectionsTable,
    gmailConnectionsStatusIndex,
    gmailTokenKmsKeyId,
    successRedirectUrl,
    failureRedirectUrl,
  };
}

function redirect(location: string): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: 302,
    headers: { location },
  };
}

export function createGoogleOAuthCallbackHandler(dependencies: GoogleOAuthCallbackDependencies) {
  const getNow = dependencies.getNow ?? (() => new Date());
  const logger = dependencies.logger ?? console;

  return async function googleOAuthCallback(
    event: APIGatewayProxyEventV2WithJWTAuthorizer,
  ): Promise<APIGatewayProxyStructuredResultV2> {
    const config = getConfig();
    const code = event.queryStringParameters?.code;
    const state = event.queryStringParameters?.state;

    if (!code || !state) {
      return redirect(config.failureRedirectUrl);
    }

    const stateRecord = await dependencies.oauthStateRepository.consume(state);

    if (!stateRecord) {
      return redirect(config.failureRedirectUrl);
    }

    if (new Date(stateRecord.expiresAt).getTime() <= getNow().getTime()) {
      return redirect(config.failureRedirectUrl);
    }

    try {
      const params = await dependencies.parameterStore.loadParams();
      const tokenResult = await dependencies.googleOAuthClient.exchangeCodeForTokens({
        clientId: params.gmailOAuthClientId,
        clientSecret: params.gmailOAuthClientSecret,
        redirectUri: stateRecord.redirectUri,
        code,
      });

      if (!tokenResult.refreshToken) {
        logger.error("Google OAuth callback did not return a refresh token", {
          userId: stateRecord.userId,
        });
        return redirect(config.failureRedirectUrl);
      }

      const googleAccountProfile = await dependencies.googleOAuthClient.getGoogleAccountProfile({
        clientId: params.gmailOAuthClientId,
        clientSecret: params.gmailOAuthClientSecret,
        redirectUri: stateRecord.redirectUri,
        accessToken: tokenResult.accessToken,
        refreshToken: tokenResult.refreshToken,
      });

      const encryptedRefreshToken = await dependencies.tokenEncryptionService.encryptRefreshToken(
        tokenResult.refreshToken,
        { userId: stateRecord.userId },
      );

      await dependencies.gmailConnectionRepository.upsertPrimary({
        userId: stateRecord.userId,
        googleSub: googleAccountProfile.googleSub,
        gmailAddress: googleAccountProfile.gmailAddress,
        encryptedRefreshToken,
        status: "active",
        occurredAt: getNow().toISOString(),
      });

      return redirect(config.successRedirectUrl);
    } catch (error) {
      logger.error("Google OAuth callback failed", {
        userId: stateRecord.userId,
        error: error instanceof Error ? error.message : "unknown_error",
      });
      return redirect(config.failureRedirectUrl);
    }
  };
}

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const config = getConfig();
  const defaultHandler = createGoogleOAuthCallbackHandler({
    parameterStore: new ParameterStoreService(ssm, config.appSecretsPrefix),
    oauthStateRepository: new DynamoDbOAuthStateRepository(ddb, config.oauthStateTable),
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
