# Daily Accountability Tracker

A no-framework HTML/CSS/JavaScript tracker for 1 Nov–30 Dec 2026. Both users see and edit the same records. Each task update is stored in `data/data.json` in a GitHub repository through a Vercel serverless function.

## Important architecture note
This is not static-only hosting: a small Vercel Function (`api/data.js`) is required to keep the GitHub token secret and write the JSON file. No database or browser localStorage is used.

## Deploy

1. Push this project's files, including `data/data.json`, to a GitHub branch. The configured repository must not be empty.
2. Keep the GitHub repository private (recommended).
3. Create a GitHub fine-grained personal access token:
   - Repository access: only the repository you created.
   - Repository permissions: **Contents: Read and write**.
4. Import the repository into Vercel and deploy.
5. In Vercel → Project → Settings → Environment Variables, add:
   - `GITHUB_TOKEN` = the token above
   - `GITHUB_OWNER` = your GitHub username or organization
   - `GITHUB_REPO` = repository name
   - `GITHUB_BRANCH` = branch containing the project (usually `main`)
   - `DATA_FILE_PATH` = `data/data.json`
6. Redeploy after adding environment variables.
7. Open the same Vercel URL on both devices. No account or login is built in.

If the page reports that shared data is unavailable, confirm it is opened from the Vercel deployment (not a local file or GitHub Pages), verify all three required GitHub environment variables in Vercel, and redeploy after changing them. The page's connection alert shows the API's error detail.

## Usage
- Select a date and mark each task Done or Missed.
- Missed requires a reason.
- Updates are written to the shared JSON file. The page refreshes shared records every 30 seconds and when it becomes active; reloading also retrieves the latest records.
- Performance reports show selected day, selected week (Monday–Sunday), selected month, and the full tracking period.
- Pending tasks are excluded from the completion-rate denominator. The report separately displays pending counts.

## Access and privacy
The website has no authentication, as requested. Anyone who obtains the public Vercel URL can read the records and submit task updates. The GitHub token is kept in Vercel environment variables and is never sent to the browser. Keep the GitHub repository private. This is shared access, not private partner-only access.

## Concurrency
The API re-reads the latest JSON and retries GitHub content conflicts. This reduces lost updates when two people update at nearly the same time, but GitHub's file API is not a transactional database. Avoid editing the same task simultaneously.

## Validation
Run the API tests with `node --test api/data.test.js`. These tests use a mocked GitHub API and do not require credentials.
