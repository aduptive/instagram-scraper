# instagram-scraper

Fetch recent posts from public Instagram profiles, no login required. TypeScript, a single dependency (axios), built-in delays and rate limiting so you don't get your IP blocked in the first minute.

## Install

```bash
npm install @aduptive/instagram-scraper
```

## Usage

```typescript
import { InstagramScraper } from '@aduptive/instagram-scraper';

const scraper = new InstagramScraper();
const results = await scraper.getPosts('instagram', 12);

if (results.success && results.posts) {
  console.log(`got ${results.posts.length} posts`);
  await scraper.saveToJson(results, 'posts.json');
} else {
  console.error(results.error);
}
```

Each post comes with id, shortcode, caption, like/comment counts, timestamp, post URL and the media items (images, videos and carousel children, with dimensions).

## Config

All optional:

```typescript
const scraper = new InstagramScraper({
  maxRetries: 3,           // retries for network/timeout/5xx errors
  minDelay: 1000,          // random pause between requests, in ms
  maxDelay: 3000,
  timeout: 10000,          // per-request timeout in ms
  rateLimitPerMinute: 30,  // hard cap on requests per minute
});
```

Notes on how these behave:

- Retries only happen for transient errors (network, timeout, Instagram 5xx). A 429, 404 or 403 fails immediately, since retrying those just digs the hole deeper.
- The rate limit is a sliding one-minute window over every request the scraper makes (profile + media), on top of the random min/max delay.

## Error handling

`getPosts` doesn't throw for scraping failures. Check `results.success`:

```typescript
const results = await scraper.getPosts('someuser');
if (!results.success) {
  // results.error is a message, results.code is one of:
  // RATE_LIMITED, PROFILE_NOT_FOUND, ACCESS_DENIED, TIMEOUT,
  // NETWORK_ERROR, SERVER_ERROR
  console.error(results.code, results.error);
}
```

## Limitations

- Public profiles only.
- Without login Instagram only serves the ~12 most recent posts of a profile, so a higher `limit` won't get you more than that.
- This relies on Instagram's web API, which they can change whenever they feel like it. If something breaks, [open an issue](https://github.com/aduptive/instagram-scraper/issues).

## Scraping multiple profiles

Do it sequentially, and give it some breathing room between accounts. A shared scraper instance keeps the rate-limit window across profiles:

```typescript
const scraper = new InstagramScraper();

for (const username of ['nasa', 'natgeo']) {
  const results = await scraper.getPosts(username, 12);
  console.log(username, results.success ? results.posts?.length : results.error);
  await new Promise((r) => setTimeout(r, 60_000));
}
```

Running scrapes in parallel against Instagram is the fastest way to get rate limited. Don't.

## License

MIT. Use it responsibly and check Instagram's terms of service. This is for collecting public data, not for abuse.
