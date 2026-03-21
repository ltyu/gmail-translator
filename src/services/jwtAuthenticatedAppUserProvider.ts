import { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { IAuthenticatedAppUser, IAuthenticatedAppUserProvider } from "../types.js";

type JwtClaims = Record<string, string | undefined>;

function hasRequiredScopes(actualScopes: string[], requiredScopes: readonly string[]): boolean {
  return requiredScopes.every((requiredScope) => actualScopes.includes(requiredScope));
}

export class JwtAuthenticatedAppUserProvider
  implements IAuthenticatedAppUserProvider<APIGatewayProxyEventV2WithJWTAuthorizer>
{
  constructor(private readonly requiredScopes: readonly string[] = []) {}

  async getAuthenticatedUser(
    event: APIGatewayProxyEventV2WithJWTAuthorizer,
  ): Promise<IAuthenticatedAppUser | null> {
    const claims = event.requestContext.authorizer.jwt.claims as JwtClaims;
    const scopes = event.requestContext.authorizer.jwt.scopes ?? [];
    const sub = claims.sub;

    if (!sub || typeof sub !== "string") {
      return null;
    }

    if (claims.gty === "client-credentials" || sub.endsWith("@clients")) {
      return null;
    }

    if (!hasRequiredScopes(scopes, this.requiredScopes)) {
      return null;
    }

    return { userId: sub };
  }
}
