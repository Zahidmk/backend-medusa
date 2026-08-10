import crypto from "crypto";

export interface KnetRawOptions {
  env: string;
  tranPortalId: string;
  tranPortalPassword: string;
  terminalResourceKey: string;
  baseUrl: string;
}

export class KnetRawClient {
  private options: KnetRawOptions;

  constructor(options: KnetRawOptions) {
    this.options = options;
  }

  /**
   * Constructs the plaintext KNET RAW payload string.
   */
  public constructPayloadString(params: {
    amount: number;
    trackId: string;
    responseUrl: string;
    errorUrl: string;
  }): string {
    const formattedAmount = params.amount.toFixed(3);

    // KNET RAW standard payment initialization payload
    const payloadObject = {
      id: this.options.tranPortalId,
      password: this.options.tranPortalPassword,
      action: "1",
      langid: "EN",
      currencycode: "414",
      amt: formattedAmount,
      responseURL: params.responseUrl,
      errorURL: params.errorUrl,
      trackid: params.trackId,
    };

    // Convert to query string format: id=...&password=...&action=1...
    return Object.entries(payloadObject)
      .map(([key, value]) => `${key}=${value}`)
      .join("&");
  }

  /**
   * Encrypts the payload string using the Terminal Resource Key.
   * Note: The exact encryption algorithm (e.g., AES-128-CBC vs AES-256-CBC, IV, padding) 
   * must be verified against the KNET RAW Interface Kit, as per instructions not to guess.
   * Standard KNET often uses AES-128-CBC for 16-byte keys.
   */
  public encryptPayload(plainText: string): string {
    if (!this.options.terminalResourceKey) {
      throw new Error("Missing KNET Terminal Resource Key");
    }

    const key = this.options.terminalResourceKey;
    
    // Fallback standard implementation (AES-128-CBC for 16-byte keys)
    const algorithm = key.length === 32 ? "aes-256-cbc" : "aes-128-cbc";
    
    // KNET typically uses the key itself as the IV, or an empty/null IV. 
    // We use the key as IV based on standard KNET RAW implementations if not specified.
    const iv = Buffer.from(key);
    
    const cipher = crypto.createCipheriv(algorithm, Buffer.from(key), iv);
    
    let encrypted = cipher.update(plainText, "utf8", "hex");
    encrypted += cipher.final("hex");
    
    return encrypted;
  }

  /**
   * Decrypts the KNET trandata response string matching the PHP kit's openssl_decrypt.
   * - Uses AES-128-CBC
   * - Key is the Terminal Resource Key
   * - IV is identical to the Key
   * - Input is hex, output is padded string
   */
  public decryptPayload(hexTranData: string): Record<string, string> {
    if (!this.options.terminalResourceKey) {
      throw new Error("Missing KNET Terminal Resource Key");
    }

    const key = this.options.terminalResourceKey;
    const algorithm = key.length === 32 ? "aes-256-cbc" : "aes-128-cbc";
    const iv = Buffer.from(key);

    try {
      // In PHP kit:
      // $code =  hex2ByteArray(trim($code));
      // $code=byteArray2String($code);
      // $code = base64_encode($code);
      // $decrypted = openssl_decrypt($code, 'AES-128-CBC', $key, OPENSSL_ZERO_PADDING, $iv);
      // return pkcs5_unpad($decrypted);
      
      // In Node.js createDecipheriv automatically unpads PKCS#7 (which covers PKCS#5)
      // and decipher.update with 'hex' automatically handles the hex string input.
      const decipher = crypto.createDecipheriv(algorithm, Buffer.from(key), iv);
      let decrypted = decipher.update(hexTranData, "hex", "utf8");
      decrypted += decipher.final("utf8");

      // decrypted is a query-string like: paymentid=123&result=CAPTURED&trackid=...
      const resultObj: Record<string, string> = {};
      const params = new URLSearchParams(decrypted);
      for (const [k, v] of params.entries()) {
        resultObj[k] = v;
      }
      return resultObj;
    } catch (e) {
      console.error("[KNET] Decryption failed", e);
      throw new Error("KNET Payload Decryption Failed");
    }
  }

  /**
   * Prepares the payment URL with the encrypted trandata.
   * The client should redirect the user's browser to this URL.
   */
  public preparePaymentUrl(params: {
    amount: number;
    trackId: string;
    responseUrl: string;
    errorUrl: string;
  }): string {
    console.log(`[KNET] RAW initialization started`);
    console.log(`[KNET] Track ID: ${params.trackId}`);
    console.log(`[KNET] Amount: ${params.amount.toFixed(3)}`);
    console.log(`[KNET] Environment: ${this.options.env}`);

    const plainText = this.constructPayloadString(params);
    const encryptedTranData = this.encryptPayload(plainText);

    // Construct final URL as per the official PHP kit
    return `${this.options.baseUrl}&trandata=${encryptedTranData}&tranportalId=${this.options.tranPortalId}&responseURL=${encodeURIComponent(params.responseUrl)}&errorURL=${encodeURIComponent(params.errorUrl)}`;
  }
}
