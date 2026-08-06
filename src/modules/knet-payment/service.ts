import {
  AbstractPaymentProvider,
  PaymentProviderError,
  PaymentProviderSessionResponse,
  PaymentSessionStatus,
  Logger
} from "@medusajs/framework/utils"

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
  protected logger_: Logger

  constructor(container: { logger: Logger }, options: KnetOptions) {
    super(container)
    this.options_ = options
    this.logger_ = container.logger
  }

  async initiatePayment(
    context: any
  ): Promise<PaymentProviderError | PaymentProviderSessionResponse> {
    try {
      const { amount, currency_code, context: customerContext } = context

      // Note: Full integration with resource.cgn typically requires an e24paymentpipe Java/PHP wrapper.
      // This is a placeholder for generating the Knet URL.
      // E.g., we would spawn a child process or call an internal service to get the encrypted payment URL.
      
      this.logger_.info(`Initializing Knet Payment for ${amount} ${currency_code}`)

      const knetPaymentUrl = `https://kpaytest.com.kw/portal/merchant.htm?paymentId=mock_${Date.now()}`

      return {
        session_data: {
          url: knetPaymentUrl,
          id: `knet_${Date.now()}`,
          status: "pending"
        },
        update_requests: {
          customer_metadata: {
            knet_transaction_id: `knet_${Date.now()}`
          }
        }
      }
    } catch (e) {
      return {
        error: e.message,
        code: "unknown",
        detail: e
      }
    }
  }

  async authorizePayment(
    paymentSessionData: Record<string, unknown>,
    context: Record<string, unknown>
  ): Promise<PaymentProviderError | {
    status: PaymentSessionStatus;
    data: PaymentProviderSessionResponse["session_data"];
  }> {
    try {
      const status = paymentSessionData.status as string

      return {
        data: paymentSessionData,
        status: status === "success" ? PaymentSessionStatus.AUTHORIZED : PaymentSessionStatus.PENDING,
      }
    } catch (error) {
      return {
        error: error.message,
        code: "unknown",
        detail: error,
      }
    }
  }

  async cancelPayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<PaymentProviderError | PaymentProviderSessionResponse["session_data"]> {
    return {
      ...paymentSessionData,
      status: "canceled"
    }
  }

  async capturePayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<PaymentProviderError | PaymentProviderSessionResponse["session_data"]> {
    return {
      ...paymentSessionData,
      status: "captured"
    }
  }

  async deletePayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<PaymentProviderError | PaymentProviderSessionResponse["session_data"]> {
    return paymentSessionData
  }

  async getPaymentStatus(
    paymentSessionData: Record<string, unknown>
  ): Promise<PaymentSessionStatus> {
    const status = paymentSessionData.status as string
    
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

  async refundPayment(
    paymentSessionData: Record<string, unknown>,
    refundAmount: number
  ): Promise<PaymentProviderError | PaymentProviderSessionResponse["session_data"]> {
    return {
      ...paymentSessionData,
      refunded_amount: refundAmount
    }
  }

  async updatePayment(
    context: any
  ): Promise<PaymentProviderError | PaymentProviderSessionResponse> {
    return this.initiatePayment(context)
  }

  async getWebhookActionAndData(payload: any): Promise<any> {
    return {
      action: "authorized",
      data: payload
    }
  }
}
