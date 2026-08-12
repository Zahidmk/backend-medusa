import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { Modules } from "@medusajs/framework/utils";
import { KnetRawClient } from "../../../modules/knet-payment/knet-client";

// Opt out of default authentication middleware for external payment gateway callback
export const AUTHENTICATE = false;

async function handleKnetCallback(req: MedusaRequest, res: MedusaResponse) {
  const contentType = (req.headers["content-type"] || "") as string;
  console.log("[KNET Callback] Request received");
  console.log(`[KNET Callback] Content-Type: ${contentType}`);

  try {
    // Body can come from URLSearchParams/HTML parser in middleware or req.query (GET)
    const body = (req as any).body || {};
    const query = (req.query || {}) as Record<string, any>;
    
    // Merge query & body for universal POST/GET support
    let payload = { ...query, ...body };

    // Secondary fail-safe if trandata is missing but rawBody exists
    if (!payload.trandata && (req as any).rawBody) {
      const rawStr = String((req as any).rawBody).trim();
      try {
        const params = new URLSearchParams(rawStr);
        for (const [key, val] of params.entries()) {
          if (key && val && !payload[key]) payload[key] = val;
        }
      } catch { /* ignore */ }
      
      if (!payload.trandata) {
        const inputRegex = /<input\s+[^>]*name=["']?([^"'\s>]+)["']?[^>]*value=["']?([^"'\s>]*)["']?[^>]*>/gi;
        let match: RegExpExecArray | null;
        while ((match = inputRegex.exec(rawStr)) !== null) {
          if (match[1] && match[2] && !payload[match[1]]) payload[match[1]] = match[2];
        }
      }
    }

    console.log(`[KNET Callback] Body keys: ${Object.keys(payload).join(", ")}`);
    console.log(`[KNET Callback] trandata present: ${payload.trandata ? "yes" : "no"}`);

    const tranData = payload.trandata;
    const errorText = payload.ErrorText || payload.errortext;
    const errorNo = payload.Error || payload.error;
    const trackIdFromError = payload.trackid || payload.trackId;

    const frontendSuccessUrl = process.env.MARKASOUQ_FRONTEND_URL 
      ? `${process.env.MARKASOUQ_FRONTEND_URL}/payment/knet/callback` 
      : "https://website.markasouqs.com/payment/knet/callback";
      
    const frontendErrorUrl = process.env.MARKASOUQ_FRONTEND_URL 
      ? `${process.env.MARKASOUQ_FRONTEND_URL}/payment/knet/callback` 
      : "https://website.markasouqs.com/payment/knet/callback";

    // 1. Handle KNET error fields (if present without trandata)
    if (errorText || errorNo) {
      console.error(`[KNET Callback] Error returned by KNET: ${errorNo} - ${errorText}`);
      const errRedirect = `${frontendErrorUrl}?error=${encodeURIComponent(errorText || "Payment failed")}`;
      console.log(`[KNET Callback] Returning redirect: ${errRedirect}`);
      return res.status(200).send(`REDIRECT=${errRedirect}`);
    }

    if (!tranData) {
      console.error("[KNET Callback] No trandata found in request");
      const errRedirect = `${frontendErrorUrl}?error=missing_trandata`;
      console.log(`[KNET Callback] Returning redirect: ${errRedirect}`);
      return res.status(200).send(`REDIRECT=${errRedirect}`);
    }

    console.log(`[KNET Callback] trandata received: ${tranData.substring(0, 20)}...`);
    console.log("[KNET Callback] Decryption started");

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
      console.log("[KNET Callback] Decryption successful");
    } catch (e: any) {
      console.error("[KNET Callback] Decryption failed:", e?.message || e);
      const errRedirect = `${frontendErrorUrl}?error=decryption_failed`;
      console.log(`[KNET Callback] Returning redirect: ${errRedirect}`);
      return res.status(200).send(`REDIRECT=${errRedirect}`);
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
    } = decryptedPayload;

    console.log(`[KNET Callback] Parsed result: ${result}`);
    console.log(`[KNET Callback] Track ID: ${trackid}`);
    console.log(`[KNET Callback] Amount: ${amt}`);
    console.log(`[KNET Callback] Payment ID: ${paymentid}`);

    // 4. Verify payment mapping
    const targetTrackId = trackid || trackIdFromError;
    if (!targetTrackId) {
      console.error("[KNET Callback] Missing trackid in decrypted payload");
      const errRedirect = `${frontendErrorUrl}?error=invalid_payload`;
      console.log(`[KNET Callback] Returning redirect: ${errRedirect}`);
      return res.status(200).send(`REDIRECT=${errRedirect}`);
    }

    const paymentModuleService = req.scope.resolve(Modules.PAYMENT);
    
    // Robust session lookup: try ID directly first, then query by data.track_id or data.cart_id
    console.log(`[KNET Callback] Payment session lookup for: ${targetTrackId}`);
    let session: any = null;
    
    try {
      session = await paymentModuleService.retrievePaymentSession(targetTrackId);
    } catch (e) {
      // Search active payment sessions
      try {
        const sessions = await paymentModuleService.listPaymentSessions({});
        session = sessions.find((s: any) => 
          s.id === targetTrackId || 
          s.data?.track_id === targetTrackId ||
          s.data?.trackId === targetTrackId ||
          (udf1 && s.data?.cart_id === udf1)
        );
      } catch (listErr) {
        console.error("[KNET Callback] Failed to list payment sessions", listErr);
      }
    }

    if (!session) {
      console.error(`[KNET Callback] Payment Session not found for trackid: ${targetTrackId}`);
      const errRedirect = `${frontendErrorUrl}?error=session_not_found`;
      console.log(`[KNET Callback] Returning redirect: ${errRedirect}`);
      return res.status(200).send(`REDIRECT=${errRedirect}`);
    }

    console.log(`[KNET Callback] Payment session found: ${session.id}`);

    // 5. Verify Amount (Medusa KWD amount is in fils or major units depending on session)
    let sessionMajorAmount = session.amount;
    if (session.currency_code?.toLowerCase() === "kwd" && session.amount > 500) {
      sessionMajorAmount = session.amount / 1000;
    }
    const sessionAmountStr = sessionMajorAmount.toFixed(3);
    const receivedAmountStr = parseFloat(amt || "0").toFixed(3);

    if (sessionAmountStr !== receivedAmountStr) {
      console.error(`[KNET Callback] Amount mismatch. Expected: ${sessionAmountStr}, Received: ${receivedAmountStr}`);
      const errRedirect = `${frontendErrorUrl}?error=amount_mismatch`;
      console.log(`[KNET Callback] Returning redirect: ${errRedirect}`);
      return res.status(200).send(`REDIRECT=${errRedirect}`);
    }

    // 6. Update session data to store KNET transaction details
    const updatedData = {
      ...(session.data || {}),
      knet_payment_id: paymentid,
      knet_result: result,
      knet_auth: auth,
      knet_ref: ref,
      knet_tranid: tranid,
      knet_postdate: postdate,
      status: result === "CAPTURED" ? "success" : "failed"
    };

    await paymentModuleService.updatePaymentSession({
      id: session.id,
      currency_code: session.currency_code,
      amount: session.amount,
      data: updatedData
    });

    // 7. Authorize payment in Medusa if successful
    let authResultStatus = "pending";
    if (result === "CAPTURED") {
      try {
        await paymentModuleService.authorizePaymentSession(
          session.id,
          {}
        );
        authResultStatus = "authorized";
        console.log(`[KNET Callback] Authorization result: ${authResultStatus} for session ${session.id}`);
      } catch (e: any) {
        console.error(`[KNET Callback] Authorization failed for session ${session.id}:`, e?.message || e);
      }
    } else {
      console.log(`[KNET Callback] Authorization skipped. Result: ${result}`);
    }

    // 8. Return REDIRECT=<URL> as required by KNET
    const cartId = session.data?.cart_id || udf1 || "";
    const finalRedirectUrl = result === "CAPTURED"
      ? `${frontendSuccessUrl}?cart_id=${cartId}&status=success`
      : `${frontendErrorUrl}?error=${encodeURIComponent(result || "failed")}`;

    console.log(`[KNET Callback] Returning redirect: ${finalRedirectUrl}`);
    return res.status(200).send(`REDIRECT=${finalRedirectUrl}`);
    
  } catch (error: any) {
    console.error("[KNET Callback] Fatal error processing callback", error);
    const errRedirect = "https://website.markasouqs.com/payment/knet/callback?error=internal_server_error";
    console.log(`[KNET Callback] Returning redirect: ${errRedirect}`);
    return res.status(200).send(`REDIRECT=${errRedirect}`);
  }
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  return handleKnetCallback(req, res);
};

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  return handleKnetCallback(req, res);
};
