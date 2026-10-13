# Campus Inventory Frontend

React and Vite frontend for the LavaLust Product Management API. The browser
communicates with the API over HTTP; database credentials belong only in the
backend environment and must never be added here.

## Requirements

- Node.js 20.19+ or 22.12+
- The LavaLust API running locally or deployed

## Local development

From this directory, copy `.env.example` to `.env.local` and set
`VITE_API_BASE_URL` to the API origin (without a trailing slash). The example
uses `http://localhost/LavaLustLab6` for the local XAMPP Apache application.

```powershell
npm ci
npm run dev
```

Open the URL printed by Vite. Create an account or sign in; registrations are
stored in the API database with the standard `user` role. The inventory shown
after sign-in is loaded from the API database, and product create, update, and
delete actions are persisted there. For cross-origin local development,
configure the backend `CORS_ALLOWED_ORIGINS` to match Vite's origin exactly.

## Production build

```powershell
npm ci
npm run build
```

Vite writes the static production site to `dist/`. Configure
`VITE_API_BASE_URL` in the static host's build environment to the deployed
LavaLust API URL, and configure the API's `CORS_ALLOWED_ORIGINS` to the exact
HTTPS origin serving this frontend.

## Render

The included `render.yaml` defines this repository as a Render Static Site,
builds with Node.js 22.12.0, installs the locked dependencies with `npm ci`,
publishes `dist/`, and rewrites application routes to `index.html`.

1. Create a Render Static Site from this repository's Blueprint.
2. Set `VITE_API_BASE_URL` to the deployed backend API origin without a
   trailing slash (for example, `https://your-api.onrender.com`).
3. Add the frontend's exact HTTPS origin (for example,
   `https://your-frontend.onrender.com`) to the backend's
   `CORS_ALLOWED_ORIGINS`.
4. Keep database credentials and JWT signing secrets exclusively on the
   backend. They are not needed by this static site.
