require('dotenv').config({ path: process.env.DOTENV_PATH || undefined });

const required = ['DATABASE_URL', 'JWT_SECRET'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  // Refuse to boot without secrets — no silent fallbacks.
  throw new Error(`Missing required environment variables: ${missing.join(', ')}. Copy .env.example to .env.`);
}

module.exports = {
  port: Number(process.env.PORT) || 4000,
  nodeEnv: process.env.NODE_ENV || 'development',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:2000',
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  platformOwner: {
    name: process.env.PLATFORM_OWNER_NAME || 'Platform Admin',
    email: process.env.PLATFORM_OWNER_EMAIL,
    password: process.env.PLATFORM_OWNER_PASSWORD
  },
  uploadDir: process.env.UPLOAD_DIR || 'uploads',
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB) || 10,
  billingSchedulerMinutes: Number(process.env.BILLING_SCHEDULER_MINUTES ?? 360)
};
