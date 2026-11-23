VaalAuras — Cloudflare Workers Site
===================================

Public site: Home (Download + custom buttons), Guide, Changelog, and Patreon / Twitch / Discord buttons.
No memberships, no payments, no visitor accounts. The only login is YOUR developer login,
which unlocks editing of the Home page, Guide and Changelog right on the site.

1. Deploy to Cloudflare Workers
   Option A (GitHub + Cloudflare Dashboard):
     - Push this folder to a PRIVATE GitHub repo.
     - dash.cloudflare.com -> Workers & Pages -> Create -> Import a repository.
     - Leave Build command empty and set Deploy command to: npx wrangler deploy
   Option B (terminal):
     npx wrangler login
     npx wrangler deploy

2. Add these Secrets (Worker -> Settings -> Variables and Secrets):
   - SESSION_SIGNING_SECRET   any random string, 32+ characters
   - DEV_LOGIN_EMAIL          your admin email
   - DEV_LOGIN_PASSWORD       your admin password

   The old Twitch / Patreon secrets (TWITCH_*, PATREON_*, DEV_TWITCH_LOGINS) are no longer used and can be deleted.

3. Bind a KV namespace so edits are saved permanently:
   - Dashboard -> Storage & Databases -> KV -> Create namespace.
   - Worker -> Settings -> Bindings -> Add -> KV Namespace -> Variable name: CONTENT_KV.
   Your existing CONTENT_KV (with Guide / Changelog posts) keeps working as is.

4. Using it
   - Click "Sign in" (top right) and log in with your developer email and password.
   - Home: click "Edit page" to change title, tags, text, the Download button link,
     add / remove / reorder extra buttons, and change the Patreon / Twitch / Discord links.
   - Guide / Changelog: the same "New Article" / "New Changelog Post" and edit buttons as before.
   - Visitors only see buttons that have a link. Set your Download link in "Edit page".

Local dev: copy .env.example to .dev.vars, fill it in, run `npm run dev`.
Tests: `npm test`
