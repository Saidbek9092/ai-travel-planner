# Deploying `ai-travel-web` to Vercel

`vercel.json` holds the build settings; these steps need your Vercel and Mapbox accounts and are done once.
The agent runs on Render (`ARCHITECTURE.md` §13).

1. **Import the repo** in Vercel as project `ai-travel-web`. Set **Root Directory** to `apps/web`.
   Build, install and the Ignored Build Step (`npx turbo-ignore`) come from `vercel.json`.
2. **Environment variables** (Preview and Production):
   - `NEXT_PUBLIC_AGENT_URL`: the Render agent's URL. It is inlined at build time, so redeploy after changing it.
     Without it a build runs in UI-only mode and shows the "agent not connected" notice.
   - `NEXT_PUBLIC_MAPBOX_TOKEN`: a URL-restricted public token. Add the production domain and the
     preview pattern (`https://ai-travel-web-*.vercel.app/*`) to the token's allowed URLs.
3. **Agent side:** the agent's `WEB_ORIGIN` must list the production domain and the preview domains, or the browser's
   calls are blocked by CORS.
4. **Production branch:** `main`. Every PR then gets a preview deployment.

CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests and build, then the Playwright end-to-end tests.
