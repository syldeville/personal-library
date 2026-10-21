# MangaDex proxy

MangaDex doesn't let apps on other websites call it straight from the browser, and it blocks hot-linked images ([their rules](https://api.mangadex.org/docs/2-limitations)). This tiny Cloudflare Worker passes the app's requests on to MangaDex. It's free and takes about five minutes to set up.

It only forwards to MangaDex, and only answers your own app's address.

## Setup

1. Create a free account at [dash.cloudflare.com](https://dash.cloudflare.com/sign-up). No card is needed.
2. Go to **Compute (Workers) → Workers & Pages → Create → Create Worker**.
3. Name it something like `library-proxy` and press **Deploy**.
4. Press **Edit code**, delete everything in `worker.js`, paste in the contents of [`worker.js`](worker.js) from this folder, then press **Deploy**.
5. Go back to the worker and open **Settings → Variables and Secrets → Add**:
   - Type: **Text**
   - Name: `ALLOWED_ORIGIN`
   - Value: your app's address with no path, e.g. `https://your-name.github.io`

   Press **Deploy**.
6. Copy the worker's address (it looks like `https://library-proxy.your-name.workers.dev`).
7. In the app, open **Settings → MangaDex**, paste the address and press **Save**. "Connected" means it works.

## Notes

- Cloudflare's free plan allows 100,000 requests a day. Downloading a 200-page volume uses roughly 210.
- MangaDex limits how fast pages can be fetched, so a volume takes a minute or two. Keep the app open while it downloads.
- Some series only link to an official publisher. Those chapters can't be downloaded and show as "official only".
