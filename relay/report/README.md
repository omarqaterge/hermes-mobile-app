# Report a problem: the relay

The app's Settings → About → **Report a problem** turns what a user writes into an issue in
`omarqaterge/hermes-mobile-app`. The app is public, so it can't hold a GitHub token. This folder is a small
Cloudflare Worker that holds one and creates the issue for the app. Until it's deployed and its address is in a
build, the app opens GitHub's new-issue page with the report filled in, and the user submits it there. That works
already; the relay just saves them signing in to GitHub.

What it does (`worker.js`, details in [spec 3.21](../../docs/spec/03-21-report-a-problem.md)):

- `POST /` takes a report, checks its size and fields, and creates the issue with the label `from-app`. It answers with
  the issue's link.
- It allows 5 reports a day for each install (a random ID the app makes, never a phone identifier) and 20 a day for
  each internet address (stored only as a salted hash, deleted after two days). Past that it answers 429, and the app
  sends the user to GitHub's page instead.
- A screenshot the user picked (at most 3 MB) is stored in the same KV namespace and served at `/s/<random>.jpg`, so the
  issue can show it.

All of this fits Cloudflare's free plan (Workers: 100,000 requests a day; KV: 1 GB, 1,000 writes a day). The free
plan needs no payment card.

Tests: `node --test relay/report/worker.test.js` (CI runs them).

## Setup (the owner, once)

You need a Cloudflare account (free) and Node 18 or newer. Run the commands in this folder (`relay/report/`).

### 1. Create the GitHub token

1. GitHub → your picture → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained
   tokens** → **Generate new token**.
2. Name: `hermux-report-relay`. Expiration: the longest you're comfortable with (up to a year; put a reminder in your
   calendar to renew it).
3. **Resource owner:** you. **Repository access:** *Only select repositories* → `omarqaterge/hermes-mobile-app`.
4. **Permissions** → **Repository permissions** → **Issues: Read and write**. Leave everything else at *No access*
   (Metadata: read-only is added by itself).
5. **Generate token** and copy it (`github_pat_…`). You'll paste it in step 4. Don't save it in a file in this repo.

Also create the label once, so issues from the app are easy to find: the repository → **Issues** → **Labels** → **New
label** → `from-app`. (Without it GitHub creates the label anyway, without a colour.)

### 2. Sign in to Cloudflare

```bash
npx wrangler login
```

### 3. Create the KV namespace

```bash
npx wrangler kv namespace create REPORTS
```

It prints an `id`. Put it in `wrangler.toml` in place of `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`. An ID is not a secret,
but you may keep that change local instead of committing it.

### 4. Set the secrets

```bash
npx wrangler secret put GITHUB_TOKEN
```

Paste the token from step 1. Optionally also a salt for the address hashes (any long random text):

```bash
npx wrangler secret put IP_SALT
```

### 5. Deploy

```bash
npx wrangler deploy
```

It prints the Worker's address, like `https://hermux-report.<your-subdomain>.workers.dev`. Check it answers:

```bash
curl -s -X POST https://hermux-report.<your-subdomain>.workers.dev/ -d '{}'
```

This should print `{"error":"bad install id"}`. (`{"error":"relay not set up"}` means a secret or the namespace is
missing.)

### 6. Put the address in the app's builds

GitHub → the repository → **Settings** → **Secrets and variables** → **Actions** → **Variables** → **New repository
variable**: name `REPORT_RELAY_URL`, value the address from step 5. It's a variable, not a secret: it ends up in the app.
Releases are built with it from then on (`release.yml`). For a local build:

```bash
cd web && HERMES_REPORT_URL=https://hermux-report.<your-subdomain>.workers.dev npx vite build
```

## Later

- **Renew the token** before it expires: make a new one (step 1) and run `npx wrangler secret put GITHUB_TOKEN` again.
  Nothing in the app changes.
- **Change the limits:** `LIMITS` at the top of `worker.js`, then `npx wrangler deploy`.
- **Stop it:** `npx wrangler delete`. Builds that have its address then fall back to GitHub's page.
- **Remove a screenshot** someone shouldn't have sent: delete the issue's image link, then
  `npx wrangler kv key delete --binding REPORTS "shot:<the file name from the link>"`.
- **Logs:** `npx wrangler tail` while testing.
