# Deploying `ai-travel-web` to Vercel

`vercel.json` holds the build settings; these steps need your Vercel and Mapbox accounts and are done once.

1. **Import the repo** in Vercel as project `ai-travel-web`. Set **Root Directory** to `apps/web`.
   Build, install and the Ignored Build Step (`npx turbo-ignore`) come from `vercel.json`.
2. **Environment variables** (Preview and Production):
   - `NEXT_PUBLIC_MAPBOX_TOKEN`: a URL-restricted public token. Add the production domain and the
     preview pattern (`https://ai-travel-web-*.vercel.app/*`) to the token's allowed URLs.
   - **Do not set `NEXT_PUBLIC_AGENT_URL`** until the agent is deployed. Without it, previews and
     production run in UI-only mode and show the "agent not connected" banner.
3. **Production branch:** `main`. Every PR then gets a preview deployment.
4. **When the backend ships:** set `NEXT_PUBLIC_AGENT_URL`, add the Vercel domains to the agent's
   `WEB_ORIGIN`, and redeploy.

CI (`.github/workflows/ci.yml`) runs lint, typecheck and build.
