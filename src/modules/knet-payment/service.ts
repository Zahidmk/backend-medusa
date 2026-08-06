// @ts-nocheck
import { AbstractPaymentProvider, PaymentSessionStatus } from "@medusajs/framework/utils"

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
    try {
      const amount = input?.amount || 0;
      const currency = input?.currency_code || 'kwd';
      
      this.logger_?.info?.(`Initializing Knet Payment for ${amount} ${currency}`)

      const knetPaymentUrl = `https://kpaytest.com.kw/portal/merchant.htm?paymentId=mock_${Date.now()}`

      return {
        ...input,
        data: {
          url: knetPaymentUrl,
          id: `knet_${Date.now()}`,
          status: "pending"
        }
      }
    } catch (e: any) {
      return {
        error: e?.message || "Unknown error",
        code: "unknown",
        detail: e
      }
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
      return {
        error: e?.message || "Unknown error",
        code: "unknown",
        detail: e,
      }
    }
  }

  async retrievePayment(input: any): Promise<any> {
    return input
  }

  async cancelPayment(input: any): Promise<any> {
    return {
      ...input,
      data: {
        ...(input?.data || {}),
        status: "canceled"
      }
    }
  }

  async capturePayment(input: any): Promise<any> {
    return {
      ...input,
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
      ...input,
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
