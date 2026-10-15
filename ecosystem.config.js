/**
 * PM2 Ecosystem Configuration for Marqa Souq
 *
 * These entries mirror how the two processes actually run in production
 * (verified against `pm2 jlist` on the VPS, Oct 2026). The previous version of
 * this file pointed at /var/www/marqa-souq/backend/my-medusa-store/.medusa/server,
 * a path that does not exist on the server, so `pm2 start ecosystem.config.js`
 * would have failed to bring the backend up.
 *
 * Both apps are started with `npm run start` from their own directory:
 *   - backend  : npm run start  ->  medusa start   (see package.json)
 *   - frontend : npm run start  ->  next start     (separate markasouq-web repo)
 *
 * Deployment steps (backend):
 *   1. cd /var/www/marqa-souq/backend/backend-medusa && yarn build
 *   2. pm2 restart medusa-backend
 */
module.exports = {
  apps: [
    {
      name: 'medusa-backend',
      cwd: '/var/www/marqa-souq/backend/backend-medusa',
      script: 'npm',
      args: 'run start',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 9000
      },
      error_file: '/var/log/pm2/medusa-error.log',
      out_file: '/var/log/pm2/medusa-out.log',
      time: true,
      kill_timeout: 5000,
      listen_timeout: 30000,
      exp_backoff_restart_delay: 100,
    },
    {
      name: 'nextjs-storefront',
      cwd: '/var/www/marqa-souq/frontend/markasouq-web',
      script: 'npm',
      args: 'run start',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      error_file: '/var/log/pm2/nextjs-error.log',
      out_file: '/var/log/pm2/nextjs-out.log',
      time: true,
      kill_timeout: 5000,
      listen_timeout: 10000,
    }
  ]
};
