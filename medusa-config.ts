import { defineConfig, loadEnv } from "@medusajs/framework/utils"

loadEnv(process.env.NODE_ENV || "development", process.cwd())

const httpConfig = {
  storeCors: process.env.STORE_CORS || "*",
  adminCors: process.env.ADMIN_CORS || "*",
  authCors: process.env.AUTH_CORS || "*",
  jwtSecret: process.env.JWT_SECRET || "supersecret",
  cookieSecret: process.env.COOKIE_SECRET || "supersecret",
  cookieOptions: {
    secure: (process.env.BACKEND_URL || "").startsWith("https://"),
    sameSite: "lax",
  },
}

export default defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    http: httpConfig,
  },

  admin: {
    vite: () => ({
      server: {
        allowedHosts: ["admin.markasouqs.com", "localhost", "127.0.0.1"],
      },
    }),
    path: "/app",
  },

  modules: {
    auth: {
      resolve: "@medusajs/auth",
      options: {
        providers: [
          {
            resolve: "@medusajs/auth-emailpass",
            id: "emailpass",
            options: {},
          },
          // Google OAuth - only enabled if credentials are set
          ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
            ? [
              {
                resolve: "@medusajs/auth-google",
                id: "google",
                options: {
                  clientId: process.env.GOOGLE_CLIENT_ID,
                  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
                  callbackUrl: process.env.GOOGLE_CALLBACK_URL || "http://localhost:9000/auth/customer/google/callback",
                },
              },
            ]
            : []),
        ],
      },
    },

    // Payment module - enables payment collections and COD/manual payments
    // pp_system_default is the built-in provider for Cash on Delivery
    payment: {
      resolve: "@medusajs/payment",
      options: {
        providers: [
          {
            resolve: "./src/modules/knet-payment",
            id: "knet",
            options: {
              env: process.env.KNET_ENV,
              tranPortalId: process.env.KNET_TRAN_PORTAL_ID,
              tranPortalPassword: process.env.KNET_TRAN_PORTAL_PASSWORD,
              terminalResourceKey: process.env.KNET_TERMINAL_RESOURCE_KEY,
              baseUrl: process.env.KNET_BASE_URL,
            }
          }
        ],
      },
    },

    brands: { resolve: "./src/modules/brands" },
    wishlist: { resolve: "./src/modules/wishlist" },
    reviews: { resolve: "./src/modules/reviews" },
    media: { resolve: "./src/modules/media" },
    sellers: { resolve: "./src/modules/sellers" },
    warranty: { resolve: "./src/modules/warranty" },
    blog: { resolve: "./src/modules/blog" },
    "odoo_sync": { resolve: "./src/modules/odoo-sync" },

    // Notification module for email notifications
    notification: {
      resolve: "@medusajs/notification",
      options: {
        providers: [
          // SendGrid for production emails
          ...(process.env.SENDGRID_API_KEY
            ? [
              {
                resolve: "@medusajs/notification-sendgrid",
                id: "sendgrid",
                options: {
                  channels: ["email"],
                  api_key: process.env.SENDGRID_API_KEY,
                  from: process.env.SENDGRID_FROM || "noreply@markasouq.com",
                },
              },
            ]
            : []),
          // Local notification provider (logs to console in development)
          {
            resolve: "@medusajs/notification-local",
            id: "local",
            options: {
              channels: ["email", "log"],
            },
          },
        ],
      },
    },
  },
})
