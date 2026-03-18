import { DecryptCommand, EncryptCommand, KMSClient } from "@aws-sdk/client-kms";
import { IGmailTokenEncryptionContext, IGmailTokenEncryptionService } from "../types.js";

const TOKEN_CIPHERTEXT_ENCODING = "base64";
const TOKEN_ENCRYPTION_PURPOSE = "gmail-refresh-token";

function toEncryptionContext(context: IGmailTokenEncryptionContext): Record<string, string> {
  return {
    purpose: TOKEN_ENCRYPTION_PURPOSE,
    userId: context.userId,
    connectionId: context.connectionId ?? "primary",
  };
}

function toUint8Array(value: string): Uint8Array {
  return Buffer.from(value, "utf8");
}

export class KmsGmailTokenEncryptionService implements IGmailTokenEncryptionService {
  constructor(
    private readonly kms: KMSClient,
    private readonly keyId: string,
  ) {}

  async encryptRefreshToken(token: string, context: IGmailTokenEncryptionContext): Promise<string> {
    const response = await this.kms.send(
      new EncryptCommand({
        KeyId: this.keyId,
        Plaintext: toUint8Array(token),
        EncryptionContext: toEncryptionContext(context),
      }),
    );

    if (!response.CiphertextBlob) {
      throw new Error("KMS encrypt did not return ciphertext");
    }

    return Buffer.from(response.CiphertextBlob).toString(TOKEN_CIPHERTEXT_ENCODING);
  }

  async decryptRefreshToken(ciphertext: string, context: IGmailTokenEncryptionContext): Promise<string> {
    const response = await this.kms.send(
      new DecryptCommand({
        KeyId: this.keyId,
        CiphertextBlob: Buffer.from(ciphertext, TOKEN_CIPHERTEXT_ENCODING),
        EncryptionContext: toEncryptionContext(context),
      }),
    );

    if (!response.Plaintext) {
      throw new Error("KMS decrypt did not return plaintext");
    }

    return Buffer.from(response.Plaintext).toString("utf8");
  }
}
