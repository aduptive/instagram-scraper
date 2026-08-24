# instagram-scraper

Fetch public Instagram profiles, posts and media, no login required. TypeScript, zero dependencies (native fetch), built-in retries and rate limiting so you don't get your IP blocked in the first minute.

Requires Node 18 or newer.

## Install

```bash
npm install @aduptive/instagram-scraper
```

## Usage

### Recent posts of a profile

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

### Profile info

```typescript
const result = await scraper.getProfile('instagram');

if (result.success && result.profile) {
  const p = result.profile;
  console.log(p.full_name, p.followers, p.following, p.posts_count);
  console.log(p.biography, p.is_verified, p.profile_pic_url);
}
```

### A single post or reel by URL

```typescript
const result = await scraper.getPost('https://www.instagram.com/reel/CxSEjxfyJtN');
// also accepts /p/ and /tv/ URLs, or a bare shortcode

if (result.success && result.post) {
  console.log(result.post.media_type, result.post.media_items);
}
```

### Progress and cancellation

`getPosts` waits 1-2s between posts, so longer runs take a while. You can watch progress and cancel mid-run:

```typescript
const controller = new AbortController();

const results = await scraper.getPosts('instagram', 12, {
  signal: controller.signal,
  onProgress: ({ fetched, total, currentPost }) => {
    console.log(`${fetched}/${total} ${currentPost.shortcode}`);
  },
});
```

On failure or cancellation, `results.posts` still contains whatever was collected before it stopped (with `success: false` and `code: 'ABORTED'` when cancelled).

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

Methods don't throw for scraping failures. Check `success`:

```typescript
const results = await scraper.getPosts('someuser');
if (!results.success) {
  // results.error is a message, results.code is one of:
  // RATE_LIMITED, PROFILE_NOT_FOUND, POST_NOT_FOUND, ACCESS_DENIED,
  // TIMEOUT, ABORTED, NETWORK_ERROR, SERVER_ERROR
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

## Migrating from 1.x

- Node 18+ is now required (axios was replaced by native fetch).
- `getPosts` on failure now also returns the partially collected `posts` (before, `posts` was absent on failure).
- Everything else is backwards compatible; `getProfile`, `getPost`, `signal` and `onProgress` are new.

## License

MIT. Use it responsibly and check Instagram's terms of service. This is for collecting public data, not for abuse.
