// @ts-nocheck
import { AbstractPaymentProvider, PaymentSessionStatus } from "@medusajs/framework/utils"
import { KnetRawClient } from "./knet-client"

type KnetOptions = {
  institutionId: string;
  merchantId: string;
  userId: string;
  password: string;
  resourcePath: string; // path to resource.cgn
  isLive: boolean;
}

export default class KnetPaymentProviderService extends AbstractPaymentProvider<KnetOptions> {
  static identifier = "knet"
  protected options_: KnetOptions
  protected container_: any

  constructor(container: any, options: KnetOptions) {
    super(container)
    this.options_ = options
    this.logger_ = container.logger
    this.container_ = container
  }

  async initiatePayment(input: any): Promise<any> {
    console.log("===== KNET initiatePayment CALLED =====");

    try {
      const amount = input?.amount || 0;
      const currency = input?.currency_code || 'kwd';
      
      // Medusa v2 initiatePayment does NOT have input.session_id or input.id yet.
      // Generate a unique alphanumeric Track ID for KNET.
      const trackId = "KNET" + Date.now().toString() + Math.random().toString(36).substring(2, 10).toUpperCase();
      
      this.logger_?.info?.(`Initializing Knet Payment for ${amount} ${currency} with trackId ${trackId}`)

      const knetClient = new KnetRawClient({
        env: process.env.KNET_ENV || "test",
        tranPortalId: process.env.KNET_TRAN_PORTAL_ID || "",
        tranPortalPassword: process.env.KNET_TRAN_PORTAL_PASSWORD || "",
        terminalResourceKey: process.env.KNET_TERMINAL_RESOURCE_KEY || "",
        baseUrl: process.env.KNET_BASE_URL || "",
      });

      // Use the verified production backend URL for the callback
      const frontendBase = process.env.PUBLIC_BACKEND_URL || "https://admin.markasouqs.com";
      
      // Convert Medusa's minor-unit amount to major units based on currency
      let finalAmount = amount;
      const currencyLower = currency.toLowerCase();
      if (['kwd', 'bhd', 'omr'].includes(currencyLower)) {
        finalAmount = amount / 1000;
      } else if (['jpy'].includes(currencyLower)) {
        finalAmount = amount;
      } else {
        finalAmount = amount / 100;
      }
      
      let cartId = input?.data?.cart_id || input?.data?.cartId || input?.cart_id || input?.context?.cart_id || input?.context?.cart?.id || "";

      if (!cartId && input?.payment_collection_id) {
        try {
          const pgConnection = this.container_?.pgConnection || (this as any).pgConnection_;
          if (pgConnection) {
            const linkRow = await pgConnection.raw(
              `SELECT cart_id FROM cart_payment_collection WHERE payment_collection_id = ? AND deleted_at IS NULL LIMIT 1`,
              [input.payment_collection_id]
            );
            if (linkRow.rows?.[0]?.cart_id) {
              cartId = linkRow.rows[0].cart_id;
            }
          }
        } catch (err: any) {
          console.warn("[KNET] Could not resolve cart_id from payment_collection link:", err?.message || err);
        }
      }

      console.log(`[KNET] cart ID received: ${cartId ? "yes" : "no"}`);
      if (cartId) {
        console.log(`[KNET] cart ID value: ${cartId}`);
      }
      console.log(`[KNET] track ID: ${trackId}`);
      console.log(`[KNET] payment session ID: ${trackId}`);

      const knetPaymentUrl = knetClient.preparePaymentUrl({
        amount: finalAmount,
        trackId: trackId,
        cartId: cartId,
        responseUrl: `${frontendBase}/knet/callback`,
        errorUrl: `${frontendBase}/knet/callback`, // Both go to the same callback for backend verification
      });

      return {
        id: trackId, // Required by Medusa v2
        data: {
          url: knetPaymentUrl,
          track_id: trackId, // Stored to fulfill verification requirement
          cart_id: cartId,
          status: "pending"
        }
      }
    } catch (e: any) {
      console.error("KNET ERROR:", e)
      throw e
    }
  }

  async authorizePayment(input: any): Promise<any> {
    try {
      const status = input?.data?.status as string
      
      return {
        data: input?.data || {},
        status: status === "success" ? PaymentSessionStatus.AUTHORIZED : PaymentSessionStatus.PENDING,
      }
    } catch (e: any) {
      console.error("KNET ERROR:", e)
      throw e
    }
  }

  async retrievePayment(input: any): Promise<any> {
    return input
  }

  async cancelPayment(input: any): Promise<any> {
    return {
      data: {
        ...(input?.data || {}),
        status: "canceled"
      }
    }
  }

  async capturePayment(input: any): Promise<any> {
    return {
      data: {
        ...(input?.data || {}),
        status: "captured"
      }
    }
  }

  async deletePayment(input: any): Promise<any> {
    return input
  }

  async getPaymentStatus(input: any): Promise<any> {
    const status = input?.data?.status as string
    
    switch (status) {
      case "success":
        return PaymentSessionStatus.AUTHORIZED
      case "captured":
        return PaymentSessionStatus.CAPTURED
      case "canceled":
        return PaymentSessionStatus.CANCELED
      default:
        return PaymentSessionStatus.PENDING
    }
  }

  async refundPayment(input: any): Promise<any> {
    return {
      data: {
        ...(input?.data || {}),
        refunded_amount: input?.amount
      }
    }
  }

  async updatePayment(input: any): Promise<any> {
    return this.initiatePayment(input)
  }

  async getWebhookActionAndData(payload: any): Promise<any> {
    return {
      action: "authorized",
      data: payload
    }
  }
}
