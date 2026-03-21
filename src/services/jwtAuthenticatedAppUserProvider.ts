import { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { IAuthenticatedAppUser, IAuthenticatedAppUserProvider } from "../types.js";

type JwtClaims = Record<string, string | undefined>;

export class JwtAuthenticatedAppUserProvider
  implements IAuthenticatedAppUserProvider<APIGatewayProxyEventV2WithJWTAuthorizer>
{
  async getAuthenticatedUser(
    event: APIGatewayProxyEventV2WithJWTAuthorizer,
  ): Promise<IAuthenticatedAppUser | null> {
    const claims = event.requestContext.authorizer.jwt.claims as JwtClaims;
    const sub = claims.sub;

    if (!sub || typeof sub !== "string") {
      return null;
    }

    if (claims.gty === "client-credentials" || sub.endsWith("@clients")) {
      return null;
    }

    return { userId: sub };
  }
}
