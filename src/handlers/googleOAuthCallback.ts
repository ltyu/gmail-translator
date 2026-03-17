import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { KMSClient } from "@aws-sdk/client-kms";
import { SSMClient } from "@aws-sdk/client-ssm";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { google } from "googleapis";
import { DynamoDbGmailConnectionRepository } from "../repositories/dynamoDbGmailConnectionRepository.js";
import { DynamoDbOAuthStateRepository } from "../repositories/dynamoDbOAuthStateRepository.js";
import { KmsGmailTokenEncryptionService } from "../services/kmsGmailTokenEncryptionService.js";
import { ParameterStoreService } from "../services/parameterStore.js";
import {
  GmailConnectionRepository,
  GmailTokenEncryptionService,
  OAuthStateRepository,
} from "../types.js";

const ssm = new SSMClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const kms = new KMSClient({});

interface GoogleOAuthCallbackConfig {
  appSecretsPrefix: string;
  oauthStateTable: string;
  gmailConnectionsTable: string;
  gmailConnectionsStatusIndex: string;
  gmailTokenKmsKeyId: string;
  successRedirectUrl: string;
  failureRedirectUrl: string;
}

interface TokenExchangeResult {
  refreshToken?: string;
  accessToken?: string;
}

interface GoogleAccountProfile {
  googleSub: string;
  gmailAddress?: string;
}

interface GoogleOAuthCallbackDependencies {
  parameterStore: ParameterStoreService;
  oauthStateRepository: OAuthStateRepository;
  gmailConnectionRepository: GmailConnectionRepository;
  tokenEncryptionService: GmailTokenEncryptionService;
  exchangeCodeForTokens: (input: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    code: string;
  }) => Promise<TokenExchangeResult>;
  getGoogleAccountProfile: (input: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    accessToken?: string;
    refreshToken?: string;
  }) => Promise<GoogleAccountProfile>;
  getNow?: () => Date;
  logger?: Pick<Console, "error">;
}

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

async function exchangeCodeForTokens(input: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}): Promise<TokenExchangeResult> {
  const oauth2Client = new google.auth.OAuth2(input.clientId, input.clientSecret, input.redirectUri);
  const { tokens } = await oauth2Client.getToken(input.code);

  return {
    refreshToken: tokens.refresh_token ?? undefined,
    accessToken: tokens.access_token ?? undefined,
  };
}

async function getGoogleAccountProfile(input: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  accessToken?: string;
  refreshToken?: string;
}): Promise<GoogleAccountProfile> {
  const oauth2Client = new google.auth.OAuth2(input.clientId, input.clientSecret, input.redirectUri);
  oauth2Client.setCredentials({
    access_token: input.accessToken,
    refresh_token: input.refreshToken,
  });

  const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
  const response = await oauth2.userinfo.get();
  const googleSub = response.data.id;

  if (!googleSub) {
    throw new Error("Unable to determine Google account subject");
  }

  return {
    googleSub,
    gmailAddress: response.data.email ?? undefined,
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
    event: APIGatewayProxyEventV2,
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
      const tokenResult = await dependencies.exchangeCodeForTokens({
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

      const googleAccountProfile = await dependencies.getGoogleAccountProfile({
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
  event: APIGatewayProxyEventV2,
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
    exchangeCodeForTokens,
    getGoogleAccountProfile,
  });

  return defaultHandler(event);
}
