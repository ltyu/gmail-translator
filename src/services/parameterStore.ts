import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { AppSecrets, GmailOAuthAppCredentials } from "../types.js";

export class ParameterStoreService {
  private cachedParams: AppSecrets | null = null;
  private readonly cachedValues = new Map<string, string>();

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

  async loadGoogleOAuthClientId(): Promise<string> {
    return this.getParam("gmail-client-id");
  }

  async loadGoogleOAuthCredentials(): Promise<GmailOAuthAppCredentials> {
    const [clientId, clientSecret] = await Promise.all([
      this.getParam("gmail-client-id"),
      this.getParam("gmail-client-secret"),
    ]);

    return {
      clientId,
      clientSecret,
    };
  }

  clearCache(): void {
    this.cachedParams = null;
    this.cachedValues.clear();
  }

  private async getParam(name: string): Promise<string> {
    const cachedValue = this.cachedValues.get(name);

    if (cachedValue) {
      return cachedValue;
    }

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

    this.cachedValues.set(name, value);
    return value;
  }
}
