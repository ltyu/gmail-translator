import { randomBytes } from "node:crypto";
import {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SSMClient } from "@aws-sdk/client-ssm";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { JwtAuthenticatedAppUserProvider } from "../services/jwtAuthenticatedAppUserProvider.js";
import { DynamoDbOAuthStateRepository } from "../repositories/dynamoDbOAuthStateRepository.js";
import { GoogleOAuthClient } from "../services/googleOAuthClient.js";
import { ParameterStoreService } from "../services/parameterStore.js";
import {
  IAuthenticatedAppUserProvider,
  IGoogleOAuthClient,
  IOAuthStateRepository,
} from "../types.js";

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

const ssm = new SSMClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

type StartGoogleOAuthConfig = {
  appSecretsPrefix: string;
  oauthStateTable: string;
};

type StartGoogleOAuthDependencies = {
  parameterStore: ParameterStoreService;
  authProvider: IAuthenticatedAppUserProvider<APIGatewayProxyEventV2WithJWTAuthorizer>;
  oauthStateRepository: IOAuthStateRepository;
  googleOAuthClient?: IGoogleOAuthClient;
  createState?: () => string;
  getNow?: () => Date;
};

function getConfig(): StartGoogleOAuthConfig {
  const appSecretsPrefix = process.env.APP_SECRETS_SSM_PREFIX;
  const oauthStateTable = process.env.GOOGLE_OAUTH_STATES_TABLE;

  if (!appSecretsPrefix) {
    throw new Error("Missing required env var: APP_SECRETS_SSM_PREFIX");
  }

  if (!oauthStateTable) {
    throw new Error("Missing required env var: GOOGLE_OAUTH_STATES_TABLE");
  }

  return { appSecretsPrefix, oauthStateTable };
}

function createState(): string {
  return randomBytes(24).toString("hex");
}

function buildCallbackUrl(event: APIGatewayProxyEventV2WithJWTAuthorizer): string {
  const domainName = event.requestContext?.domainName;
  const stage = event.requestContext?.stage;

  if (!domainName) {
    throw new Error("Missing request context domain name");
  }

  const stagePrefix = stage && stage !== "$default" ? `/${stage}` : "";

  return `https://${domainName}${stagePrefix}/auth/google/callback`;
}

export function createStartGoogleOAuthHandler(
  dependencies: StartGoogleOAuthDependencies,
) {
  const generateState = dependencies.createState ?? createState;
  const getNow = dependencies.getNow ?? (() => new Date());
  const oauthClient = dependencies.googleOAuthClient ?? new GoogleOAuthClient();

  return async function startGoogleOAuth(
    event: APIGatewayProxyEventV2WithJWTAuthorizer,
  ): Promise<APIGatewayProxyStructuredResultV2> {
    const authenticatedUser =
      await dependencies.authProvider.getAuthenticatedUser(event);

    if (!authenticatedUser) {
      return {
        statusCode: 401,
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ message: "Authentication required." }),
      };
    }

    const callbackUrl = buildCallbackUrl(event);
    const params = await dependencies.parameterStore.loadParams();
    const now = getNow();
    const state = generateState();
    const expiresAt = new Date(
      now.getTime() + OAUTH_STATE_TTL_MS,
    ).toISOString();

    await dependencies.oauthStateRepository.create({
      state,
      userId: authenticatedUser.userId,
      redirectUri: callbackUrl,
      createdAt: now.toISOString(),
      expiresAt,
    });

    const authorizationUrl = oauthClient.buildConsentUrl(
      params.gmailOAuthClientId,
      callbackUrl,
      state,
    );

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ authorizationUrl }),
    };
  };
}

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const config = getConfig();
  const defaultHandler = createStartGoogleOAuthHandler({
    parameterStore: new ParameterStoreService(ssm, config.appSecretsPrefix),
    authProvider: new JwtAuthenticatedAppUserProvider(),
    oauthStateRepository: new DynamoDbOAuthStateRepository(
      ddb,
      config.oauthStateTable,
    ),
    googleOAuthClient: new GoogleOAuthClient(),
  });

  return defaultHandler(event);
}
