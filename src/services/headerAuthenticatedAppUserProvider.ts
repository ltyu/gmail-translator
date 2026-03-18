import { APIGatewayProxyEventV2 } from "aws-lambda";
import { IAuthenticatedAppUser, IAuthenticatedAppUserProvider } from "../types.js";

const AUTHENTICATED_USER_HEADER = "x-authenticated-user-id";

export class HeaderAuthenticatedAppUserProvider
  implements IAuthenticatedAppUserProvider<APIGatewayProxyEventV2>
{
  async getAuthenticatedUser(event: APIGatewayProxyEventV2): Promise<IAuthenticatedAppUser | null> {
    const userId = event.headers[AUTHENTICATED_USER_HEADER];

    if (!userId) {
      return null;
    }

    return { userId };
  }
}
