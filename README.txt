VaalAuras — Cloudflare Workers Portal
======================================

1. (Optional) Replace public/assets/vaalauras_logo.png with your high-res logo.

2. Deploy to Cloudflare Workers:
   Option A (GitHub + Cloudflare Dashboard):
     - Push this folder to a PRIVATE GitHub repo.
     - In dash.cloudflare.com -> Workers & Pages -> Create -> Import a repository.
     - Leave Build command empty and set Deploy command to: npx wrangler deploy

   Option B (From terminal):
     npx wrangler login
     npx wrangler deploy

3. Add these Secrets in Cloudflare Dashboard -> Settings -> Variables and Secrets:
   - SESSION_SIGNING_SECRET   (any random 32+ char string)
   - TWITCH_CLIENT_ID
   - TWITCH_CLIENT_SECRET
   - TWITCH_BROADCASTER_ID    (your numeric Twitch user ID)
   - TWITCH_CHANNEL_LOGIN     (optional, your Twitch username)
   - PATREON_CLIENT_ID
   - PATREON_CLIENT_SECRET
   - PATREON_CREATOR_URL      (optional, URL to your Patreon page)
   - DEV_LOGIN_EMAIL          (developer email for fallback login)
   - DEV_LOGIN_PASSWORD       (secret password for developer login)
   - DEV_TWITCH_LOGINS        (comma-separated Twitch logins with permanent Developer access)

4. Required to save Lifetime Access unlocks & Guide/Changelog posts permanently:
   - In Cloudflare Dashboard -> Storage & Databases -> KV -> Create namespace.
   - In your Worker -> Settings -> Bindings -> Add -> KV Namespace -> Variable name: CONTENT_KV.

5. Register your OAuth Redirect URLs:
   - Twitch:  https://<your-worker-url>/auth/twitch/callback
   - Patreon: https://<your-worker-url>/auth/patreon/callback
