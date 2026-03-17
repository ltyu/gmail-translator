import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";

export async function handler(
  _event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  return {
    statusCode: 501,
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      message: "Google OAuth callback handler is not implemented yet.",
    }),
  };
}
