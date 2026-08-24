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

export class InstagramScraper {
  private readonly config: Required<ScraperConfig>;
  private requestTimes: number[] = [];

  constructor(config: Partial<ScraperConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
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
    const now = Date.now();
    this.requestTimes = this.requestTimes.filter((t) => now - t < windowMs);

    if (this.requestTimes.length >= this.config.rateLimitPerMinute) {
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
    await this.throttle();

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

      return await response.json();
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
    shortcode: string,
    signal?: AbortSignal
  ): Promise<any> {
    const data = await this.requestWithRetry(
      `https://www.instagram.com/api/v1/media/${shortcode}/info/`,
      signal,
      () =>
        new ScrapeError(`Post '${shortcode}' not found`, 'POST_NOT_FOUND', 404)
    );
    return data?.items?.[0] ?? null;
  }

  private buildPost(post: any, mediaItems: MediaItem[]): InstagramPost {
    const shortcode = post.code || post.shortcode;

    let mediaType: 'image' | 'video' | 'carousel' = 'image';
    if (post.is_video || post.video_versions) {
      mediaType = 'video';
    } else if (mediaItems.length > 1) {
      mediaType = 'carousel';
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
      const item = await this.fetchPostItem(
        post.code || post.shortcode,
        signal
      );
      if (item) {
        mediaItems = this.extractItemMedia(item);
      }
    } catch (error) {
      if (ScrapeError.isScrapeError(error) && error.code === 'ABORTED') {
        throw error;
      }
      // Media enrichment is best-effort: the post is still useful without it.
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
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`,
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
      const item = await this.fetchPostItem(shortcode, options.signal);
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
