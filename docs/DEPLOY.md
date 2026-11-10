# Deploying the Settlement Contour Tool to Databricks

Runbook for deploying this app as a Databricks App to the Arup **staging** and **prod**
workspaces. It is written for whoever runs the deploy on the Arup laptop — a person or an
assistant — and should be enough on its own. The Mac this repo is developed on can't sign in
to Arup Databricks: it writes code and pushes; the laptop pulls and deploys.

Staging is already live. Prod has not been deployed yet — see
[First prod deploy](#first-prod-deploy-one-time).

## Open questions (answer before or during the first prod deploy)

1. **Who can use the prod app?** A new app is usable only by its creator and workspace admins.
   Which Arup group should get `CAN_USE` on `settlement-contours-prod` (and on staging, if not
   already set)? Ask the user — don't copy it from another team's app.
2. **No `TODO(prod)` values remain.** Everything prod needs in `databricks.yml` is known (host,
   root path, app name). The app has no catalog, schema, Volume, Lakebase database or secret,
   so there is nothing to fill in after the first deploy.
3. **LINZ basemap key.** Neither staging nor prod provides one; users paste their own key into
   the UI (Underlays → basemap). The app used to read the key from the `geo-databricks` secret
   scope, which is off limits (below), so that was removed. If a server-side key is wanted later,
   it needs a scope owned by this project, added to **both** targets at once — see `app.yaml`.

## Rules for an assistant on the laptop

1. Sign in as **roger.yang@arup.com** only. Check before every deploy:
   `databricks current-user me -p staging` / `-p prod` → `userName` must be
   `roger.yang@arup.com`. The bundle's deploy state lives in that user's workspace folder, so
   deploying as anyone else loses track of the existing app.
2. Never create, rename or delete anything outside this project.
3. Never run `databricks bundle destroy`, `databricks apps delete`, or any other delete or drop
   command (workspace, secrets, catalog, schema, Volume, database, permissions).
4. **Ask the user before every prod step.** Staging steps can run without asking, but report
   what happened.
5. Deploy only committed code: `git status` must be clean and the branch up to date with
   `origin/main`. `bundle deploy` ships the working tree, not a commit.
6. Never print, read or echo secrets or tokens — no `databricks auth token`, no
   `databricks secrets get-secret`, no `cat ~/.databrickscfg`, no echoing `DATABRICKS_TOKEN`.
7. If code has to change on the laptop, commit and push it there, so the Mac pulls it before
   its next change.
8. Always pass **both** `-t <target>` and `-p <profile>`, matched: `-t staging -p staging`,
   `-t prod -p prod`. Never mix them.
9. Stay away from everything in [Off limits](#off-limits-in-both-workspaces). If a plan or
   command would touch any of it, stop and ask.

## Off limits in both workspaces

Another team's app (geo-databricks / nz-geotechnics) runs in the same workspaces. Never read,
change or delete any of these — the only exception is the single read-only check in
[step 9](#9-confirm-the-other-app-wasnt-touched):

- apps `nz-geotechnics-staging`, `nz-geotechnics-prod`;
- any bundle named `geo-databricks`, and anything under
  `/Workspace/Users/roger.yang@arup.com/.bundle/geo-databricks/`;
- Lakebase projects `nz-geotechnics-staging`, `nz-geotechnics-prod`;
- schema `07612303_nz_geotechnics` and its Volume `geodata`, in either catalog;
- secret scope `geo-databricks`.

This app's prod resources must be its own. Never reuse any of these.

## Environments

| | Staging (live) | Prod (new) |
|---|---|---|
| Workspace | `https://dbc-8244a8d2-0f15.cloud.databricks.com` | `https://dbc-660fdeaa-1f2a.cloud.databricks.com` |
| CLI profile | `staging` | `prod` |
| Bundle target | `staging` | `prod` |
| App name | `settlement-contours-staging` | `settlement-contours-prod` |
| Bundle root | `/Workspace/Users/roger.yang@arup.com/.bundle/settlement-contour-tool/staging` | `/Workspace/Users/roger.yang@arup.com/.bundle/settlement-contour-tool/prod` |

- Bundle name: `settlement-contour-tool`. App resource key (for `bundle run`): `settlement_app`.
- Both workspaces share one Unity Catalog metastore (prod catalogs look like
  `euw1_prod_reference_data`, staging ones `euw1_staging_reference_data`). **This app uses no
  catalog at all** — it's stateless: every upload is processed in memory and returned.
- **App resources: none.** No Volume, database, secret or warehouse, so no service-principal
  grants.
- Runtime config is all in `app.yaml` (shared by both targets); `databricks.yml` only changes
  host, root path and app name per target.
- **Arup stops idle apps almost immediately.** A `STOPPED` app is expected.
  `databricks apps start <app> -p <profile>` restarts it without redeploying.
- There is **no build step** (the frontend is static files) and **no automated test suite**.
  `.dwg` import on Databricks needs the vendored `vendor/linux-x86_64/dwg2dxf`, which is
  committed and must be in the deployed tree.
- Databricks CLI was set up with v1.17.0 (`brew install databricks/tap/databricks`).

## First prod deploy (one time)

**Before you start:** staging must already be running the exact commit you're about to deploy
to prod. If it isn't, do the staging half of [Each later release](#each-later-release) first.
The commit that added this doc also removed the LINZ secret from the app, so staging needs one
deploy of it: expect the staging plan to show an **update** of the app (its `linz-api-key`
resource removed). Databricks may also drop the staging app's own READ grant on the
`geo-databricks` scope as a result — that's expected and only concerns this app's service
principal. Anything else in that plan is a reason to stop.

Every step below is a prod step: **ask the user before each one.**

### 1. Log in and check identity

Needs: the user (browser SSO).

```bash
databricks auth login --host https://dbc-660fdeaa-1f2a.cloud.databricks.com --profile prod
databricks current-user me -p prod      # userName must be roger.yang@arup.com
databricks auth profiles                # the prod row must show Valid = YES
```

### 2. Check the app name is free

Needs: nothing (read-only).

```bash
databricks apps list -p prod            # settlement-contours-prod must NOT be listed
```

If it is listed, stop — see "Deploy plans to create an app that already exists" in
[Troubleshooting](#troubleshooting).

While here, record the other team's app as a baseline for step 9 (read-only, the one allowed
exception):

```bash
databricks apps get nz-geotechnics-prod -p prod -o json   # note app_status.state and update_time
```

### 3. Create the prod-side resources

**Nothing to create.** Staging has no schema, Volume, Lakebase project, database or secret
scope for this app, so prod doesn't either. The bundle creates the app itself in step 6. Do not
create anything here.

### 4. Fill in `TODO(prod)` values

**None.** `databricks.yml` has no `TODO(prod)` entries — confirm with
`grep -n "TODO(prod)" databricks.yml` (no output expected).

### 5. Validate and review the plan

Needs: the user's OK on the plan.

```bash
git fetch && git status -sb              # clean, "## main...origin/main" with no ahead/behind
databricks bundle validate -t prod -p prod
databricks bundle summary  -t prod -p prod
databricks bundle plan     -t prod -p prod
```

Check:
- `validate` reports host `dbc-660fdeaa-1f2a` and user `roger.yang@arup.com`.
- The plan **creates exactly one resource: the app `settlement_app`** (named
  `settlement-contours-prod`). Nothing else.
- Anything to be **deleted or recreated**, or anything not from this project → **stop** and
  ask the user.

Show the user the plan output and wait for their OK.

### 6. Deploy

Needs: the user's OK.

No build step. Just confirm the DWG converter is in the tree, then deploy:

```bash
ls -l vendor/linux-x86_64/dwg2dxf        # must exist
databricks bundle deploy -t prod -p prod
```

This syncs the files to the prod bundle root and **creates the app and its service
principal**. The app's compute can take a few minutes to become ACTIVE.

### 7. Grant access

Needs: the user's OK, and the answer to [open question 1](#open-questions-answer-before-or-during-the-first-prod-deploy).

- **Service principal grants: none.** The app has no resources, so its service principal needs
  nothing. Don't grant it anything.
- **User access:** give the group the user names `CAN_USE` on the app — in the app's
  Permissions tab, or:

  ```bash
  databricks apps update-permissions settlement-contours-prod -p prod --json \
    '{"access_control_list":[{"group_name":"<GROUP FROM THE USER>","permission_level":"CAN_USE"}]}'
  databricks apps get-permissions settlement-contours-prod -p prod
  ```

  `update-permissions` adds to the existing list; never use `set-permissions` (it replaces it).

No config changes come out of this step, so there is nothing to commit or redeploy.

### 8. Start and check the app

Needs: the user's OK.

```bash
databricks bundle run settlement_app -t prod -p prod
databricks apps get settlement-contours-prod -p prod -o json
```

In the JSON, check it's prod's, not staging's:
- `name` is `settlement-contours-prod`; `url` is the prod app URL.
- `active_deployment.source_code_path` is under `…/.bundle/settlement-contour-tool/prod/` —
  **not** `/staging/`.
- `resources` is absent or empty, and there is no env from a secret.
- `app_status.state` is `RUNNING`, `compute_status.state` is `ACTIVE`.

Then open the `url` in the browser (SSO) and check:
- the page loads with the sidebar;
- load a CSV from `sample_data/` (local on the laptop; it isn't deployed), generate contours,
  then export a DXF and confirm it downloads;
- import a `.dwg` as an underlay — it should draw, not say "save as DXF" (that means the
  vendored `dwg2dxf` is missing);
- `<app url>/api/config` returns `{"linz_api_key":""}` — expected; paste a LINZ key into the UI
  and turn on the aerial basemap if you want to check tiles.

### 9. Confirm the other app wasn't touched

Needs: nothing (read-only — the one allowed read of an off-limits item).

```bash
databricks apps get nz-geotechnics-prod -p prod -o json
```

`app_status.state` and `update_time` must match what you recorded in step 2. (If it was
`RUNNING` then and is `STOPPED` now, that's Arup's idle stop, not us — mention it to the user
but don't start it.) Do nothing else with it.

## Each later release

Code changes are made on the Mac and pushed to `main`. On the laptop:

```bash
# 1. Get the code
git checkout main && git pull
git status -sb                           # clean, "## main...origin/main", no ahead/behind

# 2. Test — no automated suite; smoke-test locally
cd backend && source .venv/bin/activate && uvicorn app:app --port 8420
#    open http://127.0.0.1:8420, load a sample CSV, generate, export; then Ctrl-C and cd ..

# 3. Build — none. Just check the DWG converter is present.
ls -l vendor/linux-x86_64/dwg2dxf

# 4. Staging
databricks current-user me -p staging    # roger.yang@arup.com
databricks bundle validate -t staging -p staging
databricks bundle summary  -t staging -p staging
databricks bundle plan     -t staging -p staging   # only an update of settlement_app expected
databricks bundle deploy   -t staging -p staging
databricks bundle run settlement_app -t staging -p staging
databricks apps start settlement-contours-staging -p staging   # only if it shows STOPPED
databricks apps get   settlement-contours-staging -p staging -o json
#    open the staging URL and check the change works
```

5. **Ask the user** before going on to prod.

6. Prod — the same commands with `-t prod -p prod`, on the **same tree**: no `git pull`, no
   edits, nothing in between.

```bash
databricks current-user me -p prod
databricks bundle validate -t prod -p prod
databricks bundle summary  -t prod -p prod
databricks bundle plan     -t prod -p prod      # only an update of settlement_app expected
databricks bundle deploy   -t prod -p prod
databricks bundle run settlement_app -t prod -p prod
databricks apps start settlement-contours-prod -p prod   # only if it shows STOPPED
databricks apps get   settlement-contours-prod -p prod -o json
```

7. Check prod as in [step 8](#8-start-and-check-the-app), and the other app as in
   [step 9](#9-confirm-the-other-app-wasnt-touched).

`deploy` alone only uploads files — the app keeps serving its previous snapshot until
`bundle run`.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `current-user me` shows someone other than roger.yang@arup.com | Logged in as the wrong user, or `DATABRICKS_*` env vars override the profile | Check env var **names** only: `printenv \| cut -d= -f1 \| grep DATABRICKS`; unset any. Re-run `databricks auth login --host <host> --profile <profile>` and sign in as roger.yang@arup.com. Don't deploy until it's right. |
| "refresh token is invalid" / auth expired | Token expired | `databricks auth login --host <host> --profile <profile>` again. |
| `bundle plan`/`deploy` wants to **create** an app that already exists, or deploy fails "app already exists" | Bundle state not found: deploying as another user, or the bundle name / `root_path` changed, so the bundle doesn't know it owns the app | **Stop. Don't delete the app.** Check the user and that `databricks.yml`'s bundle name and root paths are unchanged. If the app really is this project's (`settlement-contours-<env>`), the user can OK re-attaching it: `databricks bundle deployment bind settlement_app settlement-contours-<env> -t <env> -p <env>`. Never bind an off-limits app. |
| Browser shows "App Not Available" | The app is stopped (Arup stops idle apps) | `databricks apps start settlement-contours-<env> -p <env>`. No redeploy needed. |
| App state `CRASHED` / won't start | Startup error | Read the app's **Logs** tab (workspace → Compute → Apps → the app), or `<app url>/logz`. Usual causes: a `requirements.txt` pin with no Python 3.11 Linux wheel; an `app.yaml` `valueFrom` with no matching resource ("Error resolving resource …"); an import error. Fix on a branch, push, and redeploy staging first. |
| Blank page or old UI | Not a build issue — there's no build step. Files were deployed but `bundle run` wasn't, or the browser cached the old page, or the deployed tree was stale | Run `databricks bundle run settlement_app -t <env> -p <env>`; hard-refresh the browser; check `git log -1` matches `origin/main` and redeploy. |
| `.dwg` upload says "save as DXF" | `vendor/linux-x86_64/dwg2dxf` missing from the deployed tree | `git pull`, check `ls vendor/linux-x86_64/`, redeploy and run. |
| "multiple profiles matched" | Several `~/.databrickscfg` profiles share a host | Always pass `-p staging` / `-p prod` (rule 8). |
| Prod's `apps get` shows staging values (source path under `/staging/`, staging URL) | Deployed with a mismatched target and profile | Stop and tell the user. Redeploy with `-t prod -p prod` and run. Check `databricks.yml`'s prod target still points at the prod host and `…/settlement-contour-tool/prod`. |
| `bundle plan` is an unknown command | Older CLI | `brew upgrade databricks`, or use `bundle summary` plus `bundle deploy`'s own prompt, and tell the user you couldn't plan. |
| Basemap tiles don't load | No LINZ key — expected, the server provides none | Paste a LINZ Basemaps key into the UI. |
