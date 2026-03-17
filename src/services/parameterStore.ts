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

    const [anthropicApiKey, gmailOAuthClientId, gmailOAuthClientSecret, legacyGmailRefreshToken] = await Promise.all([
      this.getParam("anthropic-api-key"),
      this.getParam("gmail-client-id"),
      this.getParam("gmail-client-secret"),
      this.getOptionalParam("gmail-refresh-token"),
    ]);

    this.cachedParams = {
      anthropicApiKey,
      gmailOAuthClientId,
      gmailOAuthClientSecret,
      legacyGmailRefreshToken: legacyGmailRefreshToken ?? undefined,
    };
    return this.cachedParams;
  }

  clearCache(): void {
    this.cachedParams = null;
  }

  private async getParam(name: string): Promise<string> {
    const response = await this.ssm.send(
      new GetParameterCommand({ Name: `${this.prefix}/${name}` }),
    );
    const value = response.Parameter?.Value;

    if (!value) {
      throw new Error(`Missing SSM parameter: ${this.prefix}/${name}`);
    }

    return value;
  }

  private async getOptionalParam(name: string): Promise<string | null> {
    try {
      return await this.getParam(name);
    } catch (error) {
      if (error instanceof Error && error.name === "ParameterNotFound") {
        return null;
      }

      throw error;
    }
  }
}
