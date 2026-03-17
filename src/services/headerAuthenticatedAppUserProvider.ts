import { APIGatewayProxyEventV2 } from "aws-lambda";
import { AuthenticatedAppUser, AuthenticatedAppUserProvider } from "../types.js";

const AUTHENTICATED_USER_HEADER = "x-authenticated-user-id";

export class HeaderAuthenticatedAppUserProvider
  implements AuthenticatedAppUserProvider<APIGatewayProxyEventV2>
{
  async getAuthenticatedUser(event: APIGatewayProxyEventV2): Promise<AuthenticatedAppUser | null> {
    const userId = event.headers[AUTHENTICATED_USER_HEADER];

    if (!userId) {
      return null;
    }

    return { userId };
  }
}
