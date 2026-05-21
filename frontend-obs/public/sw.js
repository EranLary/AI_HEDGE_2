// Service worker for the observability admin app.
//
// One job: when the user navigates to a page and the Fly machine is
// asleep, race the origin against a short timeout. If the origin
// doesn't answer in time, serve a cached "warming" shell that polls
// /api/health and redirects once the machine is up.
//
// Bump SW_VERSION on logic changes so old caches get cleared.

const SW_VERSION = "obs-warming-v1";
const SHELL_CACHE = `obs-shell-${SW_VERSION}`;
const WARMING_URL = "/warming.html";
const ORIGIN_TIMEOUT_MS = 600;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.add(new Request(WARMING_URL, { cache: "reload" })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("obs-shell-") && k !== SHELL_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isNavigation(request) {
  if (request.mode === "navigate") return true;
  // Some browsers don't set mode reliably for top-level reloads.
  const accept = request.headers.get("accept") || "";
  return request.method === "GET" && accept.includes("text/html");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (!isNavigation(request)) return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Don't intercept the warming shell itself, the health probe, or any
  // sw / api machinery — those need to bypass for the polling to work.
  if (url.pathname === WARMING_URL) return;
  if (url.pathname === "/api/health") return;
  if (url.pathname === "/sw.js") return;

  event.respondWith(
    new Promise((resolve) => {
      let settled = false;
      const finish = (response) => {
        if (settled) return;
        settled = true;
        resolve(response);
      };

      const timeoutId = setTimeout(async () => {
        const cache = await caches.open(SHELL_CACHE);
        const cached = await cache.match(WARMING_URL);
        if (cached) {
          // Preserve the user's original destination so the shell can
          // redirect them after the machine wakes.
          const next = encodeURIComponent(url.pathname + url.search);
          // Rewrite the response so the warming shell's URL bar still
          // shows the original destination — we can't change the
          // displayed URL, but we can pass `next` via a response
          // header that the shell reads from window.location.search.
          // Simpler: just serve the shell as-is and let it use
          // document.referrer / a query param the shell reads.
          // We pass `next` via a Set-Cookie-style approach using a
          // custom response with the URL embedded.
          const body = await cached.text();
          const withNext = body.replace(
            "var next = params.get(\"next\") || \"/\";",
            `var next = params.get("next") || decodeURIComponent("${next}") || "/";`,
          );
          finish(
            new Response(withNext, {
              status: 200,
              headers: {
                "content-type": "text/html; charset=utf-8",
                "cache-control": "no-store",
              },
            }),
          );
        } else {
          // No cached shell yet — let the request continue.
          fetch(request).then(finish).catch(() => finish(Response.error()));
        }
      }, ORIGIN_TIMEOUT_MS);

      fetch(request)
        .then((response) => {
          clearTimeout(timeoutId);
          finish(response);
        })
        .catch(async () => {
          clearTimeout(timeoutId);
          // Network failure — try the warming shell as a last resort.
          const cache = await caches.open(SHELL_CACHE);
          const cached = await cache.match(WARMING_URL);
          finish(cached || Response.error());
        });
    }),
  );
});
