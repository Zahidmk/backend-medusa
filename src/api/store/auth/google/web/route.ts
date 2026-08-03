import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { OAuth2Client } from "google-auth-library";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_CALLBACK_URL;

  if (!clientId || !clientSecret || !redirectUri) {
    return res.status(500).json({ error: "Google OAuth credentials not configured." });
  }

  const oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);

  const authorizeUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: [
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/userinfo.email",
    ],
    prompt: "consent",
  });

  res.redirect(302, authorizeUrl);
};
