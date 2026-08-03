import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { OAuth2Client } from "google-auth-library";
import { ICustomerModuleService } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import jwt from "jsonwebtoken";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const code = req.query.code as string;
  const error = req.query.error as string;
  const frontendCallbackUrl = process.env.FRONTEND_AUTH_CALLBACK_URL || "http://localhost:3000/en/auth/callback";
  const jwtSecret = process.env.JWT_SECRET || "supersecret";

  if (error) {
    return res.redirect(302, `${frontendCallbackUrl}?error=${error}`);
  }

  if (!code) {
    return res.redirect(302, `${frontendCallbackUrl}?error=missing_code`);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_CALLBACK_URL;

  const oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    
    // Get user info
    const ticket = await oauth2Client.verifyIdToken({
      idToken: tokens.id_token!,
      audience: clientId,
    });
    const payload = ticket.getPayload();
    
    if (!payload || !payload.email) {
      return res.redirect(302, `${frontendCallbackUrl}?error=invalid_google_profile`);
    }
    
    const email = payload.email.toLowerCase();
    const firstName = payload.given_name || "Google";
    const lastName = payload.family_name || "User";

    const customerService: ICustomerModuleService = req.scope.resolve(Modules.CUSTOMER);
    
    // Find or create customer
    let customer;
    const customers = await customerService.listCustomers({ email });
    if (customers && customers.length > 0) {
      customer = customers[0];
    } else {
      customer = await customerService.createCustomers({
        email,
        first_name: firstName,
        last_name: lastName,
      });
    }

    // Generate Medusa Auth Token
    const token = jwt.sign(
      {
        actor_id: customer.id,
        actor_type: "customer",
      },
      jwtSecret,
      { expiresIn: "7d" }
    );
    
    // Redirect back to frontend with the token
    return res.redirect(302, `${frontendCallbackUrl}?token=${token}`);
    
  } catch (err: any) {
    console.error("Google OAuth Callback Error:", err);
    return res.redirect(302, `${frontendCallbackUrl}?error=authentication_failed`);
  }
};
