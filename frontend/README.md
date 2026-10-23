# Shop frontend

React 19 + TypeScript + Vite, Tailwind CSS, zustand. Node 22, pnpm.

## Run locally

```bash
nvm use            # Node 22 (.nvmrc)
pnpm install
pnpm dev           # http://localhost:5173
```

The backend must be running on http://localhost:8000 (see `../backend`). The app calls
`/api/*`; the Vite dev server strips `/api` and forwards to the backend, so there is no CORS.
Override the target with `VITE_API_PROXY_TARGET` in `.env`.

## Scripts

| Command          | What it does                     |
| ---------------- | -------------------------------- |
| `pnpm dev`       | Dev server with the `/api` proxy |
| `pnpm test`      | Vitest test suite                |
| `pnpm typecheck` | TypeScript check                 |
| `pnpm lint`      | oxlint                           |
| `pnpm build`     | Production build into `dist/`    |

## Deploying on AWS Amplify

Build settings are in `../amplify.yml`. In the Amplify console:

1. Set the environment variable `AMPLIFY_MONOREPO_APP_ROOT=frontend`.
2. Under **Hosting → Rewrites and redirects**, add these rules **in this order** (the `/api`
   rule must come before the SPA fallback):

   | Source address | Target address | Type |
   | --- | --- | --- |
   | `/api/<*>` | `https://<backend-host>/<*>` | 200 (Rewrite) |
   | `</^[^.]+$\|\.(?!(css\|gif\|ico\|jpg\|js\|png\|txt\|svg\|woff\|woff2\|ttf\|map\|json\|webp)$)([^.]+$)/>` | `/index.html` | 200 (Rewrite) |

   Or paste as JSON:

   ```json
   [
     { "source": "/api/<*>", "target": "https://<backend-host>/<*>", "status": "200", "condition": null },
     {
       "source": "</^[^.]+$|\\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webp)$)([^.]+$)/>",
       "target": "/index.html",
       "status": "200",
       "condition": null
     }
   ]
   ```

## How duplicate requests are prevented

- **Place order**: the store allows one request at a time. Each order attempt gets an
  `Idempotency-Key`; network errors and 5xx are retried (up to 2 times) with the same key, and
  resubmitting the same order after an unknown outcome reuses it, so the backend returns the
  original order instead of creating another. Changing the order, a success, or a definite
  rejection (409/422) starts a new key.
- **Cancel**: one cancel per order at a time, with an inline confirmation. A 409 ("already
  cancelled") reloads the list so it shows the real status.
- Data refreshes in place after every action and when the tab regains focus; the page never reloads.
