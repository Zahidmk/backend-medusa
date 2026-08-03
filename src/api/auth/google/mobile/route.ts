import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { OAuth2Client } from "google-auth-library";
import { ICustomerModuleService } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import jwt from "jsonwebtoken";

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { idToken } = req.body as { idToken?: string };
  const jwtSecret = process.env.JWT_SECRET || "supersecret";
  const clientId = process.env.GOOGLE_CLIENT_ID;

  if (!idToken) {
    return res.status(400).json({ error: "idToken is required" });
  }

  if (!clientId) {
    return res.status(500).json({ error: "Google Client ID is not configured" });
  }

  const oauth2Client = new OAuth2Client(clientId);

  try {
    // Verify the ID token
    const ticket = await oauth2Client.verifyIdToken({
      idToken,
      // You can specify multiple client IDs if you have separate ones for iOS/Android
      // audience: [clientId, process.env.GOOGLE_IOS_CLIENT_ID, process.env.GOOGLE_ANDROID_CLIENT_ID],
      audience: clientId,
    });
    
    const payload = ticket.getPayload();
    
    if (!payload || !payload.email) {
      return res.status(400).json({ error: "Invalid Google profile" });
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
    
    // Return token and customer info
    return res.status(200).json({
      token,
      customer,
    });
    
  } catch (err: any) {
    console.error("Google Mobile Auth Error:", err);
    return res.status(401).json({ error: "Authentication failed", details: err.message });
  }
};
