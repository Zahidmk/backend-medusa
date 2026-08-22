import { sendOrderStatusEmail } from "../lib/email";

async function verifyEmailTemplate() {
  console.log("=== Testing KNET Confirmation Email Template ===");

  const sampleOrderData = {
    customerName: "Zahid Test Customer",
    orderId: "ord_01JTEST1234567890",
    displayId: 10042,
    items: [
      { title: "Apple iPhone 15 Pro Max 256GB", quantity: 1, unit_price: 380000 },
      { title: "MagSafe Silicone Case - Blue", quantity: 1, unit_price: 15000 },
    ],
    subtotal: 395000,
    total: 395000,
    currencyCode: "kwd",
    shippingAddress: "Block 4, Street 12, Kuwait City, KW",
    knetDetails: {
      paymentId: "100623410000000548",
      tranId: "623410002943870",
      trackId: "KNET1787378258299N4TJ5B51",
      refId: "KNET1787378258299N4TJ5B51",
      date: "Aug 22, 2026, 08:57:58 AST (GMT+3)",
      amount: "395.000 KWD",
      status: "SUCCESS",
    },
  };

  console.log("KNET Data payload:", JSON.stringify(sampleOrderData.knetDetails, null, 2));

  // Check if SMTP environment variables are present
  const smtpUser = process.env.SMTP_USER || process.env.EMAIL_USER;
  const smtpPass = process.env.SMTP_PASS || process.env.EMAIL_PASS;

  if (!smtpUser || !smtpPass) {
    console.log("\n⚠️  Notice: SMTP_USER / SMTP_PASS is not configured in current .env file.");
    console.log("    To receive live emails on registered addresses, configure SMTP in backend .env:");
    console.log("    SMTP_HOST=smtp.gmail.com");
    console.log("    SMTP_PORT=587");
    console.log("    SMTP_USER=your-email@gmail.com");
    console.log("    SMTP_PASS=your-app-password");
    console.log("    SMTP_FROM=noreply@markasouqs.com\n");
  } else {
    console.log(`\n📧 Sending test email to recipient using SMTP_USER: ${smtpUser}`);
    await sendOrderStatusEmail("order.confirmed", "customer@example.com", sampleOrderData);
  }
}

verifyEmailTemplate().catch(console.error);
