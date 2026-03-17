import { google } from "googleapis";
import { GmailOAuthAppCredentials } from "../types.js";

export function buildGmailClient(credentials: GmailOAuthAppCredentials, refreshToken: string) {
  const oauth2Client = new google.auth.OAuth2(credentials.clientId, credentials.clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: "v1", auth: oauth2Client });
}
