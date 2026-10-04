# The Shop Mobile

Standalone Expo companion app for The Shop. It shares Supabase accounts, listings, signed-in baskets, and saved finds with the website. The Express API is included under `backend/` for authenticated seller inquiries and account confirmation emails. It does not process payments or reserve listings.

## Setup

1. Install Node.js 22.13 or newer, then run `npm install` in this folder.
2. Preserve your local `.env` file and fill in the values listed in `.env.example`. The Expo `EXPO_PUBLIC_` variables are bundled into the mobile client; use only the Supabase anon/publishable key there. Keep the Supabase service-role key and all email credentials private in `.env`.
3. In Supabase SQL Editor, run `supabase/schema.sql`, then `supabase/migrations/202610030001_account_sync.sql`. These create the marketplace and account-owned basket/saved-find tables with row-level security.
4. Enable Google in Supabase Auth. Add `<EXPO_PUBLIC_APP_SCHEME>://auth/callback` to its redirect URL allowlist. Configure Google's OAuth client to use the Supabase callback URL displayed in the provider settings.
5. Start the API with `npm run api` and the mobile app with `npm start` in separate terminals. On an Android emulator, set `EXPO_PUBLIC_API_URL=http://10.0.2.2:3001`; on a physical device, use the computer's LAN address. iOS simulator can use `http://localhost:3001`.

Use a development build for native OAuth callback testing. Replace the example scheme and iOS/Android identifiers before creating release builds. iOS simulator/native builds require macOS or a remote build service.

## Cross-device sync

Signed-in basket and saved-find records are stored in Supabase. Guest basket entries remain local until sign-in, when they merge by listing ID. The app listens for account-scoped Supabase Realtime changes and refreshes account data when returning to the foreground. If Realtime is unavailable, the foreground refresh remains the recovery path.

## Email/API configuration

`backend/index.js` is the website project's existing API server, included so this folder can run the mobile-required inquiry and account-confirmation endpoints. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` server-side. Configure Brevo API or SMTP credentials and a verified `BREVO_FROM`, or the legacy Mailgun variables, as described in `.env.example`. Never move those secrets into an `EXPO_PUBLIC_` variable or the app bundle.

For device requests, the API permits requests without a browser Origin header; browser origins can be controlled with `APP_URL` and `CORS_ALLOWED_ORIGINS`.
