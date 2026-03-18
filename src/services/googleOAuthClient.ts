import { google } from "googleapis";
import {
  IGoogleAccountProfile,
  IGoogleOAuthClient,
  ITokenExchangeResult,
} from "../types.js";

const GOOGLE_OAUTH_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
];

export class GoogleOAuthClient implements IGoogleOAuthClient {
  async exchangeCodeForTokens(input: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    code: string;
  }): Promise<ITokenExchangeResult> {
    const oauth2Client = new google.auth.OAuth2(
      input.clientId,
      input.clientSecret,
      input.redirectUri,
    );
    const { tokens } = await oauth2Client.getToken(input.code);

    return {
      refreshToken: tokens.refresh_token ?? undefined,
      accessToken: tokens.access_token ?? undefined,
    };
  }

  async getGoogleAccountProfile(input: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    accessToken?: string;
    refreshToken?: string;
  }): Promise<IGoogleAccountProfile> {
    const oauth2Client = new google.auth.OAuth2(
      input.clientId,
      input.clientSecret,
      input.redirectUri,
    );
    oauth2Client.setCredentials({
      access_token: input.accessToken,
      refresh_token: input.refreshToken,
    });

    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const response = await oauth2.userinfo.get();
    const googleSub = response.data.id;

    if (!googleSub) {
      throw new Error("Unable to determine Google account subject");
    }

    return {
      googleSub,
      gmailAddress: response.data.email ?? undefined,
    };
  }

  buildConsentUrl(clientId: string, callbackUrl: string, state: string): string {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callbackUrl,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      scope: GOOGLE_OAUTH_SCOPES.join(" "),
      state,
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }
}
