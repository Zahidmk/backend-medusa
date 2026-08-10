import { KnetRawClient } from "./src/modules/knet-payment/knet-client";
import * as dotenv from "dotenv";

dotenv.config();

async function test() {
  const client = new KnetRawClient({
    env: process.env.KNET_ENV || "test",
    tranPortalId: process.env.KNET_TRAN_PORTAL_ID || "",
    tranPortalPassword: process.env.KNET_TRAN_PORTAL_PASSWORD || "",
    terminalResourceKey: process.env.KNET_TERMINAL_RESOURCE_KEY || "",
    baseUrl: process.env.KNET_BASE_URL || "",
  });

  try {
    const url = client.preparePaymentUrl({
      amount: 12.395,
      trackId: `TEST${Date.now()}`,
      responseUrl: "https://example.com/success",
      errorUrl: "https://example.com/error"
    });
    console.log("SUCCESS: URL Generated");
    console.log(url);
  } catch(e) {
    console.log("FAIL", e);
  }
}

test();
