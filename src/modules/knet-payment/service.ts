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
  protected logger_: any

  constructor(container: { logger: any }, options: KnetOptions) {
    super(container)
    this.options_ = options
    this.logger_ = container.logger
  }

  async initiatePayment(input: any): Promise<any> {
    console.log("===== KNET initiatePayment CALLED =====");
    console.log(JSON.stringify(input, null, 2));

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
      
      const cartId = input?.cart_id || input?.context?.cart_id || ""

      const knetPaymentUrl = knetClient.preparePaymentUrl({
        amount: finalAmount,
        trackId: trackId,
        cartId: cartId,
        responseUrl: `${frontendBase}/store/knet/callback`,
        errorUrl: `${frontendBase}/store/knet/callback`, // Both go to the same callback for backend verification
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
