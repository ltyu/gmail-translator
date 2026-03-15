import { google } from "googleapis";
import { AppSecrets } from "../types.js";

export function buildGmailClient(params: AppSecrets) {
  const oauth2Client = new google.auth.OAuth2(params.clientId, params.clientSecret);
  oauth2Client.setCredentials({ refresh_token: params.refreshToken });
  return google.gmail({ version: "v1", auth: oauth2Client });
}
