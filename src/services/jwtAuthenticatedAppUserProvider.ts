import { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { IAuthenticatedAppUser, IAuthenticatedAppUserProvider } from "../types.js";

export class JwtAuthenticatedAppUserProvider
  implements IAuthenticatedAppUserProvider<APIGatewayProxyEventV2WithJWTAuthorizer>
{
  async getAuthenticatedUser(
    event: APIGatewayProxyEventV2WithJWTAuthorizer,
  ): Promise<IAuthenticatedAppUser | null> {
    const sub = event.requestContext.authorizer.jwt.claims.sub;

    if (!sub || typeof sub !== "string") {
      return null;
    }

    return { userId: sub };
  }
}
