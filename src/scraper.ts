import { promises as fs } from 'fs';
import { DEFAULT_CONFIG, MOBILE_USER_AGENTS } from './constants';
import { ScrapeError } from './errors';
import type {
  GetPostsOptions,
  InstagramPost,
  InstagramProfile,
  MediaItem,
  PostResponse,
  ProfileResponse,
  ScraperConfig,
  ScraperResponse,
} from './types';

const RETRIABLE = ['NETWORK_ERROR', 'TIMEOUT', 'SERVER_ERROR'];

function extractShortcode(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.includes('/')) {
    return /\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/.exec(trimmed)?.[1] ?? null;
  }
  return /^[A-Za-z0-9_-]+$/.test(trimmed) ? trimmed : null;
}

const SHORTCODE_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// The /api/v1/media/{id}/info/ endpoint takes the numeric media id, not the
// shortcode. A shortcode is that id in base64url (at most 11 chars — anything
// longer is not a media shortcode, so don't silently truncate it).
function shortcodeToMediaId(shortcode: string): string | null {
  if (shortcode.length > 11) {
    return null;
  }
  let id = 0n;
  for (const char of shortcode) {
    const index = SHORTCODE_ALPHABET.indexOf(char);
    if (index === -1) return null;
    id = id * 64n + BigInt(index);
  }
  return id.toString();
}

export class InstagramScraper {
  private readonly config: Required<ScraperConfig>;
  private requestTimes: number[] = [];

  constructor(config: Partial<ScraperConfig> = {}) {
    const cleaned = Object.fromEntries(
      Object.entries(config).filter(([, value]) => value !== undefined)
    ) as Partial<ScraperConfig>;
    this.config = { ...DEFAULT_CONFIG, ...cleaned };

    const { maxRetries, minDelay, maxDelay, timeout, rateLimitPerMinute } =
      this.config;
    if (
      !Number.isInteger(maxRetries) ||
      maxRetries < 1 ||
      !Number.isFinite(minDelay) ||
      minDelay < 0 ||
      !Number.isFinite(maxDelay) ||
      maxDelay < minDelay ||
      !Number.isFinite(timeout) ||
      timeout <= 0 ||
      !Number.isInteger(rateLimitPerMinute) ||
      rateLimitPerMinute < 1
    ) {
      throw ScrapeError.invalidConfig(
        'expected maxRetries >= 1, 0 <= minDelay <= maxDelay, timeout > 0, rateLimitPerMinute >= 1'
      );
    }
  }

  private getRandomHeaders(): Record<string, string> {
    const userAgent =
      MOBILE_USER_AGENTS[Math.floor(Math.random() * MOBILE_USER_AGENTS.length)];

    return {
      'User-Agent': userAgent,
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      Connection: 'keep-alive',
      'X-IG-App-ID': '936619743392459',
      'X-ASBD-ID': '198387',
      'X-IG-WWW-Claim': '0',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: 'https://www.instagram.com/',
      Origin: 'https://www.instagram.com',
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Dest': 'empty',
    };
  }

  private delay(
    min: number = this.config.minDelay,
    max: number = this.config.maxDelay
  ): Promise<void> {
    const time = Math.floor(Math.random() * (max - min + 1) + min);
    return new Promise((resolve) => setTimeout(resolve, time));
  }

  private async throttle(): Promise<void> {
    const windowMs = 60000;
    // Loop instead of a single wait: concurrent callers waking up together
    // must re-check the window or they all slip in at once.
    for (;;) {
      const now = Date.now();
      this.requestTimes = this.requestTimes.filter((t) => now - t < windowMs);
      if (this.requestTimes.length < this.config.rateLimitPerMinute) {
        break;
      }
      const waitMs = windowMs - (now - this.requestTimes[0]);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    this.requestTimes.push(Date.now());
  }

  private statusToError(
    status: number,
    notFound: () => ScrapeError
  ): ScrapeError {
    switch (status) {
      case 429:
        return ScrapeError.rateLimited();
      case 404:
        return notFound();
      case 403:
        return ScrapeError.accessDenied();
      default:
        if (status >= 500) {
          return ScrapeError.serverError();
        }
        return ScrapeError.networkError(`HTTP Error ${status}`);
    }
  }

  private async request(
    url: string,
    signal: AbortSignal | undefined,
    notFound: () => ScrapeError
  ): Promise<any> {
    // An already-aborted signal never fires its 'abort' listener, so check
    // explicitly both before and after the throttle wait.
    if (signal?.aborted) {
      throw new ScrapeError('Request aborted', 'ABORTED');
    }
    await this.throttle();
    if (signal?.aborted) {
      throw new ScrapeError('Request aborted', 'ABORTED');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeout);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const response = await fetch(url, {
        headers: this.getRandomHeaders(),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw this.statusToError(response.status, notFound);
      }

      try {
        return await response.json();
      } catch (error) {
        // Only a syntax error is a parse problem (HTML page, login wall,
        // format change) — not worth retrying. Aborts, timeouts and broken
        // streams during body reading keep their own classification below.
        if (error instanceof SyntaxError) {
          throw ScrapeError.parseError();
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof ScrapeError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        if (signal?.aborted) {
          throw new ScrapeError('Request aborted', 'ABORTED');
        }
        throw ScrapeError.timeout();
      }
      throw ScrapeError.networkError(
        error instanceof Error ? error.message : 'Unknown error'
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  private async requestWithRetry(
    url: string,
    signal: AbortSignal | undefined,
    notFound: () => ScrapeError
  ): Promise<any> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.request(url, signal, notFound);
      } catch (error) {
        const code = error instanceof ScrapeError ? error.code : undefined;
        if (
          attempt >= this.config.maxRetries ||
          !RETRIABLE.includes(code ?? '')
        ) {
          throw error;
        }
        await this.delay();
      }
    }
  }

  private extractMedia(item: any): MediaItem[] {
    const mediaItems: MediaItem[] = [];
    const video = item.video_versions?.[0];
    const image = item.image_versions2?.candidates?.[0];

    if (video) {
      mediaItems.push({
        url: video.url,
        type: 'video',
        width: video.width,
        height: video.height,
      });
      if (image) {
        mediaItems.push({
          url: image.url,
          type: 'thumbnail',
          width: image.width,
          height: image.height,
        });
      }
    } else if (image) {
      mediaItems.push({
        url: image.url,
        type: 'image',
        width: image.width,
        height: image.height,
      });
    }

    return mediaItems;
  }

  private extractItemMedia(item: any): MediaItem[] {
    if (!item.video_versions && item.carousel_media) {
      const mediaItems: MediaItem[] = [];
      for (const media of item.carousel_media) {
        mediaItems.push(...this.extractMedia(media));
      }
      return mediaItems;
    }
    return this.extractMedia(item);
  }

  private async fetchPostItem(
    mediaId: string,
    signal?: AbortSignal
  ): Promise<any> {
    const data = await this.requestWithRetry(
      `https://www.instagram.com/api/v1/media/${mediaId}/info/`,
      signal,
      () =>
        new ScrapeError(`Post '${mediaId}' not found`, 'POST_NOT_FOUND', 404)
    );
    return data?.items?.[0] ?? null;
  }

  // ponytail: try the numeric media id first (what the endpoint documents),
  // fall back to the shortcode once — drop the fallback after a live check
  // confirms which identifier Instagram actually accepts here.
  private async fetchPostItemWithFallback(
    mediaId: string,
    fallback: string | null,
    signal?: AbortSignal
  ): Promise<any> {
    try {
      return await this.fetchPostItem(mediaId, signal);
    } catch (error) {
      if (
        fallback &&
        fallback !== mediaId &&
        ScrapeError.isScrapeError(error) &&
        error.code === 'POST_NOT_FOUND'
      ) {
        return this.fetchPostItem(fallback, signal);
      }
      throw error;
    }
  }

  private buildPost(post: any, mediaItems: MediaItem[]): InstagramPost {
    const shortcode = post.code || post.shortcode;
    const sidecarChildren = post.edge_sidecar_to_children?.edges;

    // Classify from the post's structural fields, not from how many media
    // items enrichment happened to return.
    let mediaType: 'image' | 'video' | 'carousel' = 'image';
    if (post.is_video || post.video_versions) {
      mediaType = 'video';
    } else if (
      post.__typename === 'GraphSidecar' ||
      sidecarChildren?.length ||
      post.carousel_media ||
      mediaItems.length > 1
    ) {
      mediaType = 'carousel';
    }

    // Enrichment failed or was skipped: fall back to the media the profile
    // feed response already carries.
    if (mediaItems.length === 0) {
      // 'video' only when there is an actual video URL — a video post whose
      // feed data carries just display_url gets its cover as a thumbnail,
      // never a fake video_url.
      const feedItem = (node: any): MediaItem => ({
        url: node.video_url || node.display_url,
        type: node.video_url
          ? ('video' as const)
          : node.is_video
            ? ('thumbnail' as const)
            : ('image' as const),
        width: node.dimensions?.width,
        height: node.dimensions?.height,
      });

      if (sidecarChildren?.length) {
        mediaItems = sidecarChildren
          .map((edge: any) => edge.node)
          .filter((node: any) => node?.display_url || node?.video_url)
          .map(feedItem);
      } else if (post.video_url || post.display_url) {
        mediaItems = [feedItem(post)];
      }
    }

    const processedPost: InstagramPost = {
      id: post.id,
      shortcode,
      timestamp: post.taken_at_timestamp || post.taken_at,
      display_url:
        post.display_url || post.image_versions2?.candidates?.[0]?.url,
      caption:
        post.edge_media_to_caption?.edges?.[0]?.node?.text ||
        post.caption?.text ||
        '',
      likes: post.edge_liked_by?.count || post.like_count || 0,
      comments: post.edge_media_to_comment?.count || post.comment_count || 0,
      is_video: Boolean(post.is_video || post.video_versions),
      url: `https://www.instagram.com/p/${shortcode}/`,
      media_type: mediaType,
      media_items: mediaItems,
    };

    if (mediaType === 'video' && mediaItems.length > 0) {
      const videoItem = mediaItems.find((item) => item.type === 'video');
      const thumbnailItem = mediaItems.find(
        (item) => item.type === 'thumbnail'
      );

      if (videoItem) {
        processedPost.video_url = videoItem.url;
      }
      if (thumbnailItem) {
        processedPost.thumbnail_url = thumbnailItem.url;
      }
    }

    return processedPost;
  }

  private async processPost(
    post: any,
    signal?: AbortSignal
  ): Promise<InstagramPost> {
    let mediaItems: MediaItem[] = [];
    try {
      const item = await this.fetchPostItemWithFallback(
        post.id || post.code || post.shortcode,
        post.code || post.shortcode || null,
        signal
      );
      if (item) {
        mediaItems = this.extractItemMedia(item);
      }
    } catch (error) {
      if (
        ScrapeError.isScrapeError(error) &&
        ['ABORTED', 'RATE_LIMITED', 'ACCESS_DENIED'].includes(error.code ?? '')
      ) {
        // Being blocked mid-run must stop the collection, not be hidden.
        throw error;
      }
      // Other enrichment failures are best-effort: the post is still useful
      // without extra media (buildPost falls back to the feed's own media).
    }
    return this.buildPost(post, mediaItems);
  }

  private failure(error: unknown): BaseFailure {
    if (error instanceof ScrapeError) {
      return {
        success: false,
        error: error.message,
        code: error.code,
        statusCode: error.statusCode,
      };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      code: 'UNKNOWN_ERROR',
    };
  }

  private async fetchProfileData(
    username: string,
    signal?: AbortSignal
  ): Promise<any> {
    const data = await this.requestWithRetry(
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
      signal,
      () => ScrapeError.profileNotFound(username)
    );

    if (!data?.data?.user) {
      throw ScrapeError.profileNotFound(username);
    }

    return data.data.user;
  }

  public async getProfile(
    username: string,
    options: { signal?: AbortSignal } = {}
  ): Promise<ProfileResponse> {
    try {
      if (!username) {
        return { success: false, error: 'Username is required' };
      }

      await this.delay();
      const user = await this.fetchProfileData(username, options.signal);

      const profile: InstagramProfile = {
        id: user.id,
        username: user.username,
        full_name: user.full_name || '',
        biography: user.biography || '',
        external_url: user.external_url || null,
        profile_pic_url: user.profile_pic_url_hd || user.profile_pic_url || '',
        followers: user.edge_followed_by?.count ?? 0,
        following: user.edge_follow?.count ?? 0,
        posts_count: user.edge_owner_to_timeline_media?.count ?? 0,
        is_private: Boolean(user.is_private),
        is_verified: Boolean(user.is_verified),
        is_business_account: Boolean(user.is_business_account),
        category: user.category_name || null,
      };

      return {
        success: true,
        profile,
        scraped_at: new Date().toISOString(),
      };
    } catch (error) {
      return this.failure(error);
    }
  }

  public async getPost(
    postUrlOrShortcode: string,
    options: { signal?: AbortSignal } = {}
  ): Promise<PostResponse> {
    try {
      const shortcode = extractShortcode(postUrlOrShortcode);
      if (!shortcode) {
        return { success: false, error: 'Post URL or shortcode is required' };
      }

      await this.delay();
      const item = await this.fetchPostItemWithFallback(
        shortcodeToMediaId(shortcode) ?? shortcode,
        shortcode,
        options.signal
      );
      if (!item) {
        throw new ScrapeError(
          `Post '${shortcode}' not found`,
          'POST_NOT_FOUND',
          404
        );
      }

      return {
        success: true,
        post: this.buildPost(item, this.extractItemMedia(item)),
        scraped_at: new Date().toISOString(),
      };
    } catch (error) {
      return this.failure(error);
    }
  }

  public async getPosts(
    username: string,
    limit: number = 20,
    options: GetPostsOptions = {}
  ): Promise<ScraperResponse> {
    const processedPosts: InstagramPost[] = [];

    try {
      if (!username) {
        return { success: false, error: 'Username is required' };
      }
      if (!Number.isFinite(limit) || limit < 1) {
        return { success: false, error: 'limit must be a positive number' };
      }

      await this.delay();
      const user = await this.fetchProfileData(username, options.signal);

      const posts =
        user.edge_owner_to_timeline_media?.edges?.map(
          (edge: any) => edge.node
        ) || [];
      const selected = posts.slice(0, limit);

      for (const post of selected) {
        if (options.signal?.aborted) {
          throw new ScrapeError('Request aborted', 'ABORTED');
        }
        await this.delay(1000, 2000);
        const processedPost = await this.processPost(post, options.signal);
        processedPosts.push(processedPost);
        options.onProgress?.({
          fetched: processedPosts.length,
          total: selected.length,
          currentPost: processedPost,
        });
      }

      return {
        success: true,
        username,
        posts: processedPosts,
        scraped_at: new Date().toISOString(),
      };
    } catch (error) {
      // Return whatever was collected before the failure alongside the error.
      return { ...this.failure(error), username, posts: processedPosts };
    }
  }

  public async saveToJson(
    data: ScraperResponse | ProfileResponse | PostResponse,
    filename: string = 'posts.json'
  ): Promise<boolean> {
    try {
      await fs.writeFile(filename, JSON.stringify(data, null, 2), 'utf-8');
      return true;
    } catch (error) {
      console.error('Error saving JSON:', error);
      return false;
    }
  }
}

interface BaseFailure {
  success: false;
  error: string;
  code?: string;
  statusCode?: number;
}
