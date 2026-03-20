import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { AppSecrets } from "../types.js";

export class ParameterStoreService {
  private cachedParams: AppSecrets | null = null;

  constructor(
    private readonly ssm: SSMClient,
    private readonly prefix: string,
  ) {}

  async loadParams(): Promise<AppSecrets> {
    if (this.cachedParams) {
      return this.cachedParams;
    }

    const [anthropicApiKey, gmailOAuthClientId, gmailOAuthClientSecret] = await Promise.all([
      this.getParam("anthropic-api-key"),
      this.getParam("gmail-client-id"),
      this.getParam("gmail-client-secret"),
    ]);

    this.cachedParams = {
      anthropicApiKey,
      gmailOAuthClientId,
      gmailOAuthClientSecret,
    };
    return this.cachedParams;
  }

  clearCache(): void {
    this.cachedParams = null;
  }

  private async getParam(name: string): Promise<string> {
    const response = await this.ssm.send(
      new GetParameterCommand({
        Name: `${this.prefix}/${name}`,
        WithDecryption: true,
      }),
    );
    const value = response.Parameter?.Value;

    if (!value) {
      throw new Error(`Missing SSM parameter: ${this.prefix}/${name}`);
    }

    return value;
  }
}
