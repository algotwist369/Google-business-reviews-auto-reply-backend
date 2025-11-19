# Production Checklist

## 1. Environment variables
- Copy `ex.env` → `.env` and set all placeholders.
- Double-check OAuth URLs use your HTTPS domain.
- Set `NODE_ENV=production` and `CLIENT_URL`, `API_URL` to the deployed URLs.

## 2. Build & dependencies
- Run `npm install --production`.
- Run `npm run lint` (client and server) + `npm run build` (client).
- Upload the built `client/dist` to your hosting/CDN.

## 3. Server hardening
- Start the Node server behind HTTPS (NGINX, Cloudflare, etc.).
- Ensure `helmet`, rate limiting, and logging stay enabled (already configured in `config/app.js`).
- Configure process manager (PM2/systemd) with health checks hitting `/health`.

## 4. Auto reply service
- Confirm `AUTO_REPLY_SERVICE_ENABLED=true`.
- Tune intervals via `AUTO_REPLY_SCAN_INTERVAL_MS`, `AUTO_REPLY_MAX_GENERATE`, `AUTO_REPLY_MAX_DISPATCH`.
- Monitor logs (`logs/access.log`) for OpenAI/Google errors.

## 5. Monitoring & alerts
- Tail the `logs/` directory or ship logs to your APM.
- Add uptime monitor for `/health`.
- Enable MongoDB backups (Atlas or self-hosted).

## 6. Smoke test before launch
1. Login with Google and verify redirect works.
2. Fetch reviews (`/api/reviews/all`) successfully.
3. Toggle auto reply ON; confirm backlog tasks populate and send.
4. Manually submit a reply to ensure manual overrides mark tasks as skipped.
5. Run `node run-full-test.js` to stress endpoints.

If all checks pass, you are ready to release.*** End Patch

