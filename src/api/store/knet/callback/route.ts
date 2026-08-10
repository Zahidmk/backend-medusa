import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { Modules } from "@medusajs/framework/utils";
import { KnetRawClient } from "../../../../modules/knet-payment/knet-client";

export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  try {
    // KNET sends data via application/x-www-form-urlencoded POST
    const body = req.body as any;
    
    // The main payload is in trandata
    const tranData = body.trandata;
    const errorText = body.ErrorText;
    const errorNo = body.Error;
    const trackIdFromError = body.trackid; // Only exists in some error cases

    const frontendSuccessUrl = process.env.MARKASOUQ_FRONTEND_URL 
      ? `${process.env.MARKASOUQ_FRONTEND_URL}/payment/knet/callback` 
      : "https://markasouq.com/payment/knet/callback";
      
    const frontendErrorUrl = process.env.MARKASOUQ_FRONTEND_URL 
      ? `${process.env.MARKASOUQ_FRONTEND_URL}/payment/knet/callback` 
      : "https://markasouq.com/payment/knet/callback";

    // 1. Handle KNET error fields (if present without trandata)
    if (errorText || errorNo) {
      console.error(`[KNET Callback] Error returned by KNET: ${errorNo} - ${errorText}`);
      // Return REDIRECT to frontend error page
      return res.status(200).send(`REDIRECT=${frontendErrorUrl}?error=${encodeURIComponent(errorText || "Payment failed")}`);
    }

    if (!tranData) {
      console.error("[KNET Callback] No trandata found in request");
      return res.status(200).send(`REDIRECT=${frontendErrorUrl}?error=missing_trandata`);
    }

    // 2. Initialize client to decrypt
    const client = new KnetRawClient({
      env: process.env.KNET_ENV || "test",
      tranPortalId: process.env.KNET_TRAN_PORTAL_ID || "",
      tranPortalPassword: process.env.KNET_TRAN_PORTAL_PASSWORD || "",
      terminalResourceKey: process.env.KNET_TERMINAL_RESOURCE_KEY || "",
      baseUrl: process.env.KNET_BASE_URL || "",
    });

    // 3. Decrypt trandata
    let decryptedPayload: Record<string, string>;
    try {
      decryptedPayload = client.decryptPayload(tranData);
    } catch (e) {
      console.error("[KNET Callback] Decryption failed", e);
      return res.status(200).send(`REDIRECT=${frontendErrorUrl}?error=decryption_failed`);
    }

    const {
      paymentid,
      result,
      auth,
      ref,
      tranid,
      postdate,
      trackid,
      amt,
      udf1,
      udf2,
      udf3,
      udf4,
      udf5,
    } = decryptedPayload;

    console.log(`[KNET Callback] Parsed Response:`, { trackid, result, amt, paymentid });

    // 4. Verify payment mapping
    if (!trackid) {
      console.error("[KNET Callback] Missing trackid in decrypted payload");
      return res.status(200).send(`REDIRECT=${frontendErrorUrl}?error=invalid_payload`);
    }

    // In Medusa v2, payment session IDs are 'payses_<ulid>'. 
    // We stripped 'payses_' to satisfy KNET alphanumeric requirement. We reconstruct it here.
    const paymentSessionId = trackid.startsWith('payses_') ? trackid : `payses_${trackid}`;

    const paymentModuleService = req.scope.resolve(Modules.PAYMENT);
    
    // Check if session exists
    let session: any;
    try {
      // paymentModuleService retrieves payment session by ID
      session = await paymentModuleService.retrievePaymentSession(paymentSessionId);
    } catch (e) {
      console.error(`[KNET Callback] Payment Session not found: ${paymentSessionId}`);
      return res.status(200).send(`REDIRECT=${frontendErrorUrl}?error=session_not_found`);
    }

    // 5. Verify Amount
    const sessionAmountStr = session.amount.toFixed(3);
    const receivedAmountStr = parseFloat(amt || "0").toFixed(3);

    if (sessionAmountStr !== receivedAmountStr) {
      console.error(`[KNET Callback] Amount mismatch. Expected: ${sessionAmountStr}, Received: ${receivedAmountStr}`);
      return res.status(200).send(`REDIRECT=${frontendErrorUrl}?error=amount_mismatch`);
    }

    // 6. Update session data to store KNET transaction details
    const updatedData = {
      ...session.data,
      knet_payment_id: paymentid,
      knet_result: result,
      knet_auth: auth,
      knet_ref: ref,
      knet_tranid: tranid,
      knet_postdate: postdate,
      status: result === "CAPTURED" ? "success" : "failed"
    };

    await paymentModuleService.updatePaymentSession({
      id: paymentSessionId,
      currency_code: session.currency_code,
      amount: session.amount,
      data: updatedData
    });

    // 7. Authorize payment in Medusa if successful
    if (result === "CAPTURED") {
      try {
        await paymentModuleService.authorizePaymentSession(
          paymentSessionId,
          {}
        );
        console.log(`[KNET Callback] Payment Session ${paymentSessionId} authorized successfully.`);
        // Note: The actual order completion relies on frontend returning to checkout/review
        // where it calls /carts/:id/complete, which will now succeed.
      } catch (e) {
        console.error(`[KNET Callback] Failed to authorize payment session`, e);
      }
    } else {
      console.log(`[KNET Callback] Payment not captured. Result: ${result}`);
    }

    // 8. Return exactly REDIRECT=<URL> as required by KNET
    const finalRedirectUrl = result === "CAPTURED"
      ? `${frontendSuccessUrl}?cart_id=${session.cart_id || ""}`
      : `${frontendErrorUrl}?error=${result}`;

    return res.status(200).send(`REDIRECT=${finalRedirectUrl}`);
    
  } catch (error) {
    console.error("[KNET Callback] Fatal error processing callback", error);
    return res.status(200).send(`REDIRECT=https://markasouq.com/payment/knet/callback?error=internal_server_error`);
  }
};
