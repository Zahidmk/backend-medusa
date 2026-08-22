import nodemailer from "nodemailer";

/**
 * Order Email Notification Service
 * Uses nodemailer SMTP — works with Gmail, Outlook, or any SMTP provider.
 * Configure via environment variables (see .env template).
 */

// ─── SMTP Transporter ────────────────────────────────────────────────────────

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true", // true for 465, false for 587
    auth: {
      user: process.env.SMTP_USER || "",
      pass: process.env.SMTP_PASS || "",
    },
  });
}

// ─── Brand Config ────────────────────────────────────────────────────────────

const BRAND = {
  name: "MarkaSouq",
  color: "#1D4ED8",        // Blue
  accentColor: "#2563EB",
  logo: "https://website.markasouqs.com/logo.png",
  storeUrl: process.env.STORE_URL || "https://website.markasouqs.com",
  supportEmail: process.env.SUPPORT_EMAIL || "support@markasouqs.com",
  fromEmail: process.env.SMTP_FROM || "noreply@markasouqs.com",
  fromName: process.env.SMTP_FROM_NAME || "MarkaSouq",
};

// ─── Price Formatter ─────────────────────────────────────────────────────────

function formatPrice(amount: number, currencyCode = "kwd"): string {
  const decimals = currencyCode.toLowerCase() === "kwd" ? 3 : 2;
  const value = (amount / Math.pow(10, decimals)).toFixed(decimals);
  const symbol = currencyCode.toLowerCase() === "kwd" ? "KWD" : currencyCode.toUpperCase();
  return `${symbol} ${value}`;
}

// ─── Base Email Layout ────────────────────────────────────────────────────────

function baseLayout(content: string, previewText: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${BRAND.name}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f4f6fb; color: #1a1a2e; }
    .wrapper { max-width: 600px; margin: 0 auto; padding: 24px 16px; }
    .card { background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.07); }
    .header { background: ${BRAND.color}; padding: 32px 40px; text-align: center; }
    .header img { height: 40px; }
    .header-title { color: #fff; font-size: 22px; font-weight: 700; margin-top: 16px; }
    .body { padding: 32px 40px; }
    .status-badge { display: inline-block; padding: 8px 20px; border-radius: 50px; font-size: 14px; font-weight: 600; margin-bottom: 24px; }
    .order-box { background: #f8faff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px 24px; margin: 20px 0; }
    .order-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #edf2f7; font-size: 14px; }
    .order-row:last-child { border-bottom: none; font-weight: 700; font-size: 15px; }
    .order-row span:first-child { color: #64748b; }
    .items-table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px; }
    .items-table th { background: #f1f5f9; padding: 10px 12px; text-align: left; font-weight: 600; color: #475569; border-radius: 4px; }
    .items-table td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; }
    .btn { display: block; width: fit-content; margin: 28px auto 0; background: ${BRAND.accentColor}; color: #fff !important; padding: 14px 36px; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 15px; text-align: center; }
    .tracking-box { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px; padding: 18px 20px; margin: 20px 0; text-align: center; }
    .tracking-box .label { font-size: 12px; color: #3b82f6; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
    .tracking-box .tracking-number { font-size: 18px; font-weight: 700; color: ${BRAND.color}; letter-spacing: 2px; }
    .footer { background: #f8faff; padding: 24px 40px; text-align: center; border-top: 1px solid #e2e8f0; }
    .footer p { font-size: 12px; color: #94a3b8; line-height: 1.7; }
    .footer a { color: ${BRAND.color}; text-decoration: none; }
    h2 { font-size: 20px; font-weight: 700; margin-bottom: 8px; }
    p { font-size: 14px; line-height: 1.7; color: #475569; }
  </style>
</head>
<body>
  <span style="display:none;max-height:0;overflow:hidden;">${previewText}</span>
  <div class="wrapper">
    <div class="card">
      <div class="header">
        <div style="color:#fff;font-size:26px;font-weight:800;letter-spacing:-0.5px;">${BRAND.name}</div>
        <div class="header-title">${previewText}</div>
      </div>
      ${content}
    </div>
    <div style="text-align:center;margin-top:20px;">
      <p style="font-size:12px;color:#94a3b8;">© ${new Date().getFullYear()} ${BRAND.name}. All rights reserved.</p>
      <p style="font-size:12px;color:#94a3b8;margin-top:4px;">
        <a href="${BRAND.storeUrl}" style="color:${BRAND.color};text-decoration:none;">${BRAND.storeUrl}</a>
      </p>
    </div>
  </div>
</body>
</html>`;
}

// ─── Email Templates ──────────────────────────────────────────────────────────

interface OrderEmailData {
  customerName: string;
  orderId: string;
  displayId: number | string;
  items: Array<{ title: string; quantity: number; unit_price: number }>;
  total: number;
  subtotal: number;
  currencyCode: string;
  shippingAddress?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  carrierName?: string;
  cancelledReason?: string;
  knetDetails?: {
    paymentId?: string;
    tranId?: string;
    trackId?: string;
    refId?: string;
    date?: string;
    amount?: string;
    status?: string;
  };
}

// ── 1. Order Confirmed ────────────────────────────────────────────────────────
function orderConfirmedTemplate(data: OrderEmailData): { subject: string; html: string } {
  const itemsRows = data.items
    .map(
      (item) =>
        `<tr>
          <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;">${item.title}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;text-align:center;">${item.quantity}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:600;">${formatPrice(item.unit_price * item.quantity, data.currencyCode)}</td>
        </tr>`
    )
    .join("");

  const knetReceiptBlock = data.knetDetails ? `
    <div class="order-box" style="background:#f0f9ff;border:1px solid #bae6fd;padding:18px 22px;margin:20px 0;border-radius:12px;">
      <div style="font-weight:700;color:#0369a1;margin-bottom:12px;font-size:15px;">
        💳 KNET Payment Transaction Receipt
      </div>
      ${data.knetDetails.paymentId ? `<div class="order-row"><span>Payment ID</span><span><strong>${data.knetDetails.paymentId}</strong></span></div>` : ""}
      ${data.knetDetails.tranId ? `<div class="order-row"><span>Transaction ID</span><span><strong>${data.knetDetails.tranId}</strong></span></div>` : ""}
      ${data.knetDetails.trackId ? `<div class="order-row"><span>Track ID</span><span><strong>${data.knetDetails.trackId}</strong></span></div>` : ""}
      ${data.knetDetails.date ? `<div class="order-row"><span>Transaction Date & Time</span><span>${data.knetDetails.date}</span></div>` : ""}
      ${data.knetDetails.amount ? `<div class="order-row"><span>Amount Paid</span><span><strong>${data.knetDetails.amount}</strong></span></div>` : ""}
      <div class="order-row"><span>Transaction Status</span><span style="color:#16a34a;font-weight:700;">${data.knetDetails.status || "SUCCESS"}</span></div>
    </div>
  ` : "";

  const content = `
    <div class="body">
      <span class="status-badge" style="background:#dcfce7;color:#16a34a;">✅ Order Confirmed</span>
      <h2>Thank you, ${data.customerName}!</h2>
      <p style="margin-top:8px;">Your order <strong>#${data.displayId}</strong> has been confirmed and is being prepared.</p>

      <div class="order-box">
        <div class="order-row"><span>Order Number</span><span><strong>#${data.displayId}</strong></span></div>
        ${data.shippingAddress ? `<div class="order-row"><span>Delivery To</span><span>${data.shippingAddress}</span></div>` : ""}
        <div class="order-row"><span>Payment Method</span><span>${data.knetDetails ? "KNET Online Payment" : "Cash on Delivery"}</span></div>
      </div>

      ${knetReceiptBlock}

      <table class="items-table">
        <thead><tr><th>Item</th><th style="text-align:center;">Qty</th><th style="text-align:right;">Price</th></tr></thead>
        <tbody>${itemsRows}</tbody>
      </table>

      <div class="order-box">
        <div class="order-row"><span>Subtotal</span><span>${formatPrice(data.subtotal, data.currencyCode)}</span></div>
        <div class="order-row"><span>Shipping</span><span style="color:#16a34a;">Free</span></div>
        <div class="order-row"><span>Total</span><span>${formatPrice(data.total, data.currencyCode)}</span></div>
      </div>

      <a href="${BRAND.storeUrl}/en/orders" class="btn">View My Order</a>
    </div>
    <div class="footer">
      <p>Questions? Reply to this email or contact us at <a href="mailto:${BRAND.supportEmail}">${BRAND.supportEmail}</a></p>
    </div>`;

  return {
    subject: `✅ Order Confirmed — #${data.displayId} | ${BRAND.name}`,
    html: baseLayout(content, `Your order #${data.displayId} is confirmed!`),
  };
}

// ── 2. Order Shipped ──────────────────────────────────────────────────────────
function orderShippedTemplate(data: OrderEmailData): { subject: string; html: string } {
  const trackingSection = data.trackingNumber
    ? `<div class="tracking-box">
        <div class="label">📦 Tracking Number</div>
        <div class="tracking-number">${data.trackingNumber}</div>
        ${data.carrierName ? `<p style="margin-top:8px;color:#64748b;font-size:13px;">Carrier: <strong>${data.carrierName}</strong></p>` : ""}
        ${
          data.trackingUrl
            ? `<a href="${data.trackingUrl}" style="display:inline-block;margin-top:12px;background:${BRAND.color};color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;">Track My Package →</a>`
            : ""
        }
      </div>`
    : "";

  const content = `
    <div class="body">
      <span class="status-badge" style="background:#dbeafe;color:#1d4ed8;">🚚 Order Shipped</span>
      <h2>Your order is on its way!</h2>
      <p style="margin-top:8px;">Great news, <strong>${data.customerName}</strong>! Your order <strong>#${data.displayId}</strong> has been shipped and is heading to you.</p>

      ${trackingSection}

      <div class="order-box">
        <div class="order-row"><span>Order Number</span><span><strong>#${data.displayId}</strong></span></div>
        ${data.shippingAddress ? `<div class="order-row"><span>Delivering To</span><span>${data.shippingAddress}</span></div>` : ""}
        <div class="order-row"><span>Total</span><span>${formatPrice(data.total, data.currencyCode)}</span></div>
      </div>

      <a href="${BRAND.storeUrl}/en/orders" class="btn">Track My Order</a>
    </div>
    <div class="footer">
      <p>Expected delivery within 1–3 business days. Questions? <a href="mailto:${BRAND.supportEmail}">Contact Support</a></p>
    </div>`;

  return {
    subject: `🚚 Your Order #${data.displayId} Has Been Shipped! | ${BRAND.name}`,
    html: baseLayout(content, `Order #${data.displayId} is on its way!`),
  };
}

// ── 3. Order Delivered ────────────────────────────────────────────────────────
function orderDeliveredTemplate(data: OrderEmailData): { subject: string; html: string } {
  const content = `
    <div class="body">
      <span class="status-badge" style="background:#dcfce7;color:#16a34a;">🎉 Delivered!</span>
      <h2>Your order has arrived!</h2>
      <p style="margin-top:8px;">Hi <strong>${data.customerName}</strong>, your order <strong>#${data.displayId}</strong> has been delivered. We hope you love your purchase!</p>

      <div class="order-box">
        <div class="order-row"><span>Order Number</span><span><strong>#${data.displayId}</strong></span></div>
        ${data.shippingAddress ? `<div class="order-row"><span>Delivered To</span><span>${data.shippingAddress}</span></div>` : ""}
        <div class="order-row"><span>Total Paid</span><span>${formatPrice(data.total, data.currencyCode)}</span></div>
      </div>

      <p style="margin-top:16px;text-align:center;">Loved your experience? Leave a review and help others discover great products.</p>

      <a href="${BRAND.storeUrl}/en/orders" class="btn">Rate & Review Your Purchase</a>
    </div>
    <div class="footer">
      <p>Need to return something? You have 45 days. <a href="${BRAND.storeUrl}/en/buyer-protection">Learn more about our return policy</a></p>
      <p style="margin-top:6px;">Questions? <a href="mailto:${BRAND.supportEmail}">Contact Support</a></p>
    </div>`;

  return {
    subject: `🎉 Delivered! Order #${data.displayId} | ${BRAND.name}`,
    html: baseLayout(content, `Order #${data.displayId} has been delivered!`),
  };
}

// ── 4. Order Cancelled ────────────────────────────────────────────────────────
function orderCancelledTemplate(data: OrderEmailData): { subject: string; html: string } {
  const content = `
    <div class="body">
      <span class="status-badge" style="background:#fee2e2;color:#dc2626;">❌ Order Cancelled</span>
      <h2>Your order has been cancelled</h2>
      <p style="margin-top:8px;">Hi <strong>${data.customerName}</strong>, your order <strong>#${data.displayId}</strong> has been cancelled.</p>

      ${data.cancelledReason ? `<div class="order-box"><div class="order-row"><span>Reason</span><span>${data.cancelledReason}</span></div></div>` : ""}

      <div class="order-box">
        <div class="order-row"><span>Order Number</span><span><strong>#${data.displayId}</strong></span></div>
        <div class="order-row"><span>Amount</span><span>${formatPrice(data.total, data.currencyCode)}</span></div>
      </div>

      <p style="text-align:center;margin-top:16px;">If you have any questions or this was a mistake, please contact our support team.</p>

      <a href="${BRAND.storeUrl}/en" class="btn">Continue Shopping</a>
    </div>
    <div class="footer">
      <p>Questions about your cancellation? <a href="mailto:${BRAND.supportEmail}">Contact Support</a></p>
    </div>`;

  return {
    subject: `❌ Order #${data.displayId} Cancelled | ${BRAND.name}`,
    html: baseLayout(content, `Order #${data.displayId} has been cancelled`),
  };
}

// ── 5. Out for Delivery ────────────────────────────────────────────────────────
function orderOutForDeliveryTemplate(data: OrderEmailData): { subject: string; html: string } {
  const content = `
    <div class="body">
      <span class="status-badge" style="background:#fef9c3;color:#b45309;">📍 Out for Delivery</span>
      <h2>Your order is out for delivery!</h2>
      <p style="margin-top:8px;">Hi <strong>${data.customerName}</strong>, your order <strong>#${data.displayId}</strong> is with our delivery team and will arrive today!</p>

      <div class="order-box">
        <div class="order-row"><span>Order Number</span><span><strong>#${data.displayId}</strong></span></div>
        ${data.shippingAddress ? `<div class="order-row"><span>Delivering To</span><span>${data.shippingAddress}</span></div>` : ""}
        ${data.trackingNumber ? `<div class="order-row"><span>Tracking #</span><span>${data.trackingNumber}</span></div>` : ""}
        <div class="order-row"><span>Total</span><span>${formatPrice(data.total, data.currencyCode)}</span></div>
      </div>

      <p style="text-align:center;margin-top:12px;">Please make sure someone is available to receive the delivery.</p>

      <a href="${BRAND.storeUrl}/en/orders" class="btn">View Order Details</a>
    </div>
    <div class="footer">
      <p>Questions? <a href="mailto:${BRAND.supportEmail}">Contact Support</a></p>
    </div>`;

  return {
    subject: `📍 Out for Delivery — Order #${data.displayId} | ${BRAND.name}`,
    html: baseLayout(content, `Order #${data.displayId} is out for delivery today!`),
  };
}

// ─── Main Send Function ───────────────────────────────────────────────────────

export type OrderEmailType =
  | "order.confirmed"
  | "order.shipped"
  | "order.delivered"
  | "order.out_for_delivery"
  | "order.cancelled";

export async function sendOrderStatusEmail(
  type: OrderEmailType,
  toEmail: string,
  data: OrderEmailData
): Promise<void> {
  const smtpUser = process.env.SMTP_USER || process.env.EMAIL_USER;
  const smtpPass = process.env.SMTP_PASS || process.env.EMAIL_PASS;

  if (!smtpUser || !smtpPass) {
    console.warn(`[Email] SMTP_USER or SMTP_PASS not set in environment — skipping ${type} email for order #${data.displayId} to ${toEmail}`);
    console.warn(`[Email] Setup Tip: Add SMTP_USER and SMTP_PASS (or GMAIL App Password) to your backend .env file.`);
    return;
  }

  let template: { subject: string; html: string };

  switch (type) {
    case "order.confirmed":
      template = orderConfirmedTemplate(data);
      break;
    case "order.shipped":
      template = orderShippedTemplate(data);
      break;
    case "order.delivered":
      template = orderDeliveredTemplate(data);
      break;
    case "order.out_for_delivery":
      template = orderOutForDeliveryTemplate(data);
      break;
    case "order.cancelled":
      template = orderCancelledTemplate(data);
      break;
    default:
      console.warn(`[Email] Unknown email type: ${type}`);
      return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true", // true for 465, false for 587
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  const fromEmail = process.env.SMTP_FROM || smtpUser || "noreply@markasouqs.com";
  const fromName = process.env.SMTP_FROM_NAME || BRAND.name;

  console.log(`[Email] Attempting to send ${type} email to ${toEmail} for order #${data.displayId}...`);
  if (data.knetDetails) {
    console.log(`[Email] KNET Receipt Details attached: PaymentID=${data.knetDetails.paymentId}, TranID=${data.knetDetails.tranId}, Status=${data.knetDetails.status}`);
  }

  const info = await transporter.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to: toEmail,
    subject: template.subject,
    html: template.html,
  });

  console.log(`[Email] ✅ Sent ${type} email to ${toEmail} for order #${data.displayId} (MessageID: ${info.messageId || "sent"})`);
}
