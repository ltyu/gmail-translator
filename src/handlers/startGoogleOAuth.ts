import { randomBytes } from "node:crypto";
import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SSMClient } from "@aws-sdk/client-ssm";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { HeaderAuthenticatedAppUserProvider } from "../services/headerAuthenticatedAppUserProvider.js";
import { DynamoDbOAuthStateRepository } from "../repositories/dynamoDbOAuthStateRepository.js";
import { ParameterStoreService } from "../services/parameterStore.js";
import { AuthenticatedAppUserProvider, OAuthStateRepository } from "../types.js";

const GOOGLE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
];
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

const ssm = new SSMClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

interface StartGoogleOAuthConfig {
  appSecretsPrefix: string;
  callbackUrl: string;
  oauthStateTable: string;
}

interface StartGoogleOAuthDependencies {
  parameterStore: ParameterStoreService;
  authProvider: AuthenticatedAppUserProvider<APIGatewayProxyEventV2>;
  oauthStateRepository: OAuthStateRepository;
  createState?: () => string;
  getNow?: () => Date;
}

function getConfig(): StartGoogleOAuthConfig {
  const appSecretsPrefix = process.env.APP_SECRETS_SSM_PREFIX;
  const callbackUrl = process.env.GOOGLE_OAUTH_CALLBACK_URL;
  const oauthStateTable = process.env.GOOGLE_OAUTH_STATES_TABLE;

  if (!appSecretsPrefix) {
    throw new Error("Missing required env var: APP_SECRETS_SSM_PREFIX");
  }

  if (!callbackUrl) {
    throw new Error("Missing required env var: GOOGLE_OAUTH_CALLBACK_URL");
  }

  if (!oauthStateTable) {
    throw new Error("Missing required env var: GOOGLE_OAUTH_STATES_TABLE");
  }

  return { appSecretsPrefix, callbackUrl, oauthStateTable };
}

function createState(): string {
  return randomBytes(24).toString("hex");
}

function buildGoogleConsentUrl(clientId: string, callbackUrl: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_OAUTH_SCOPES.join(" "),
    state,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export function createStartGoogleOAuthHandler(dependencies: StartGoogleOAuthDependencies) {
  const generateState = dependencies.createState ?? createState;
  const getNow = dependencies.getNow ?? (() => new Date());

  return async function startGoogleOAuth(
    event: APIGatewayProxyEventV2,
  ): Promise<APIGatewayProxyStructuredResultV2> {
    const authenticatedUser = await dependencies.authProvider.getAuthenticatedUser(event);

    if (!authenticatedUser) {
      return {
        statusCode: 401,
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ message: "Authentication required." }),
      };
    }

    const config = getConfig();
    const params = await dependencies.parameterStore.loadParams();
    const now = getNow();
    const state = generateState();
    const expiresAt = new Date(now.getTime() + OAUTH_STATE_TTL_MS).toISOString();

    await dependencies.oauthStateRepository.create({
      state,
      userId: authenticatedUser.userId,
      redirectUri: config.callbackUrl,
      createdAt: now.toISOString(),
      expiresAt,
    });

    return {
      statusCode: 302,
      headers: {
        location: buildGoogleConsentUrl(params.gmailOAuthClientId, config.callbackUrl, state),
      },
    };
  };
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const config = getConfig();
  const defaultHandler = createStartGoogleOAuthHandler({
    parameterStore: new ParameterStoreService(ssm, config.appSecretsPrefix),
    authProvider: new HeaderAuthenticatedAppUserProvider(),
    oauthStateRepository: new DynamoDbOAuthStateRepository(ddb, config.oauthStateTable),
  });

  return defaultHandler(event);
}
