---
name: its-time-production-deploy
description: Deploy the Its Time CRM as one verified release across GitHub, Vercel frontend, VPS Docker backend, and self-hosted Supabase. Use when publishing production changes or migrations.
---

# Its Time production deploy

Use this skill only for an explicitly authorized production release. The release invariant is one immutable Git commit shared by the release branch, `main`, the Vercel deployment, and the VPS image.

## Before changing anything

- Read the repository instructions and the current runbook:
  - `AGENTS.md`
  - `docs/releases/2026-09-14-production-runbook.md`
  - `DEPLOY_VERCEL_VPS.md`
  - `scripts/deploy-backend-vps.sh`
- Inspect `git status`, worktrees, current branch, and the remote refs.
- Never discard, reset, clean, or overwrite pre-existing user work. If the worktree is dirty, use a separate worktree from the intended base commit.
- Confirm the exact release source and target branch before any push. Do not assume that a release branch and `main` are interchangeable.
- Do not print environment values, tokens, private database URLs, JWTs, or secret-bearing command output.

## Build the release

1. Fetch the remote refs without changing the working tree.
2. Create the release branch from the current `origin/main` (for example `goku`) in a clean worktree.
3. Integrate only the requested commits/features. Review the commit graph and diff; exclude WIP assets, generated files, editor leftovers, and unrelated staged changes.
4. Run the repository checks appropriate to the diff:
   - frontend: `npm ci`, `npm run typecheck`, `npm run lint`, `npm run build`;
   - backend: `Project/IA/npm ci`, `npm run lint`, `npm run build`, `npm test`;
   - database: local Supabase reset/tests when safe and available.
5. Before publishing, record the immutable SHA:
   `RELEASE_SHA=$(git rev-parse HEAD)`.
   The final `goku` and `main` refs must resolve to this same SHA.

## Supabase self-hosted migration gate

- The official project is self-hosted. Stop if the active destination is `hvziqfbnkicryfndoep` or any `*.supabase.co` URL.
- Never use `supabase --linked` for this project and never apply production SQL ad hoc outside migration history.
- Create new migration files with `supabase migration new <name>`.
- On the destination, use the private direct Postgres URL only:
  ```bash
  supabase migration list --db-url "$SELFHOST_DB_URL"
  supabase db push --db-url "$SELFHOST_DB_URL" --dry-run --skip-vault
  ```
- Require a verified backup and a dry-run delta matching the release before applying:
  ```bash
  supabase db push --db-url "$SELFHOST_DB_URL" --yes --skip-vault
  supabase migration list --db-url "$SELFHOST_DB_URL"
  ```
- Run schema preflight/advisors and verify grants, RLS, functions, and required tables. If a migration gate fails, stop before the runtime deploy. Never delete migration history or perform a destructive rollback.

## Publish the same commit

- Push the clean release branch and `main` only after all local gates pass. Verify both remote refs with `git ls-remote`; do not rely on a local branch name.
- Vercel is linked to the Vite project in `.vercel/project.json`. For Git-integrated production, the push to `main` should create the production deployment. If a direct CLI deployment is required, pull production env, build with production env, and deploy the prebuilt artifact; never put service-role/secret values in frontend env.
- Verify the Vercel deployment is READY and its Git commit SHA equals `RELEASE_SHA`.

## VPS/Docker deploy

- The backend and workers run in Docker Swarm behind Traefik. Use the repository's `scripts/setup-backend-vps.sh` for first setup or `scripts/deploy-backend-vps.sh` for subsequent releases.
- Set `GIT_BRANCH` explicitly to the branch containing `RELEASE_SHA`; use `main` only when the VPS is intentionally tracking `main`.
- Run the self-hosted Supabase migration gate before the backend deploy; the backend script's schema preflight is an additional gate, not a substitute for migration application.
- Verify the expected API, collection-worker, and agenda-worker replicas, public `/health` HTTP 200, image tag/SHA, and absence of restart loops or secrets in logs.
- Keep frontend and backend on the same `RELEASE_SHA`. If the VPS script pulls a different ref or fast-forward fails, stop.

## Post-deploy and rollback

- Smoke-test `https://app.itstime.pro`, `https://api.itstime.pro/health`, authentication, and the changed feature.
- Observe 5xx errors, worker restarts, queues, Realtime/Auth/Storage health, and migration/preflight logs.
- For a failed application release, revert the frontend/backend artifacts to the prior verified commit. Keep database migrations applied; fix forward with a new migration. Do not run `git reset --hard`, `supabase db reset`, `DROP`, or destructive database rollback against production.
- If any gate, health check, or same-SHA check fails, stop and report the exact failed gate and current refs.
