import axios, { AxiosInstance } from 'axios';
import { promises as fs } from 'fs';
import { DEFAULT_CONFIG, MOBILE_USER_AGENTS } from './constants';
import { ScrapeError } from './errors';
import type {
  InstagramPost,
  MediaItem,
  ScraperConfig,
  ScraperResponse,
} from './types';

export class InstagramScraper {
  private readonly axios: AxiosInstance;
  private readonly config: Required<ScraperConfig>;

  constructor(config: Partial<ScraperConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.axios = axios.create({
      timeout: this.config.timeout,
      headers: this.getRandomHeaders(),
    });
  }

  private getRandomHeaders(): Record<string, string> {
    const userAgent =
      MOBILE_USER_AGENTS[Math.floor(Math.random() * MOBILE_USER_AGENTS.length)];

    return {
      'User-Agent': userAgent,
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
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

  private async fetchPostMedia(shortcode: string): Promise<MediaItem[]> {
    try {
      const response = await this.axios.get(
        `https://www.instagram.com/api/v1/media/${shortcode}/info/`
      );

      const mediaItems: MediaItem[] = [];
      const data = response.data;

      if (data.items && data.items[0]) {
        const item = data.items[0];

        if (item.video_versions) {
          mediaItems.push({
            url: item.video_versions[0].url,
            type: 'video',
            width: item.video_versions[0].width,
            height: item.video_versions[0].height,
          });
          if (item.image_versions2?.candidates) {
            mediaItems.push({
              url: item.image_versions2.candidates[0].url,
              type: 'thumbnail',
              width: item.image_versions2.candidates[0].width,
              height: item.image_versions2.candidates[0].height,
            });
          }
        } else if (item.carousel_media) {
          for (const media of item.carousel_media) {
            if (media.video_versions) {
              mediaItems.push({
                url: media.video_versions[0].url,
                type: 'video',
                width: media.video_versions[0].width,
                height: media.video_versions[0].height,
              });
              if (media.image_versions2?.candidates) {
                mediaItems.push({
                  url: media.image_versions2.candidates[0].url,
                  type: 'thumbnail',
                  width: media.image_versions2.candidates[0].width,
                  height: media.image_versions2.candidates[0].height,
                });
              }
            } else if (media.image_versions2?.candidates) {
              mediaItems.push({
                url: media.image_versions2.candidates[0].url,
                type: 'image',
                width: media.image_versions2.candidates[0].width,
                height: media.image_versions2.candidates[0].height,
              });
            }
          }
        } else if (item.image_versions2?.candidates) {
          mediaItems.push({
            url: item.image_versions2.candidates[0].url,
            type: 'image',
            width: item.image_versions2.candidates[0].width,
            height: item.image_versions2.candidates[0].height,
          });
        }
      }

      return mediaItems;
    } catch (error) {
      console.error('Error fetching media:', error);
      return [];
    }
  }

  private async fetchFromApi(username: string): Promise<any> {
    try {
      const response = await this.axios.get(
        `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`,
        {
          headers: {
            ...this.getRandomHeaders(),
            'X-IG-App-ID': '936619743392459',
          },
        }
      );

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        // Tratamento específico para cada tipo de erro
        if (error.code === 'ECONNABORTED') {
          return Promise.reject(ScrapeError.timeout());
        }

        if (!error.response) {
          return Promise.reject(ScrapeError.networkError(error.message));
        }

        switch (error.response.status) {
          case 429:
            return Promise.reject(ScrapeError.rateLimited());
          case 404:
            return Promise.reject(ScrapeError.profileNotFound(username));
          case 403:
            return Promise.reject(ScrapeError.accessDenied());
          default:
            if (error.response.status >= 500) {
              return Promise.reject(ScrapeError.serverError());
            }
            return Promise.reject(
              ScrapeError.networkError(`HTTP Error ${error.response.status}`)
            );
        }
      }

      // Se não for um erro do axios
      return Promise.reject(
        error instanceof Error
          ? ScrapeError.networkError(error.message)
          : ScrapeError.networkError('Unknown error')
      );
    }
  }

  private async processPost(post: any): Promise<InstagramPost> {
    const mediaItems = await this.fetchPostMedia(post.code || post.shortcode);

    let mediaType: 'image' | 'video' | 'carousel' = 'image';
    if (post.is_video) {
      mediaType = 'video';
    } else if (mediaItems.length > 1) {
      mediaType = 'carousel';
    }

    const processedPost: InstagramPost = {
      id: post.id,
      shortcode: post.code || post.shortcode,
      timestamp: post.taken_at_timestamp || post.taken_at,
      display_url:
        post.display_url || post.image_versions2?.candidates?.[0]?.url,
      caption:
        post.edge_media_to_caption?.edges?.[0]?.node?.text ||
        post.caption?.text ||
        '',
      likes: post.edge_liked_by?.count || post.like_count || 0,
      comments: post.edge_media_to_comment?.count || post.comment_count || 0,
      is_video: post.is_video,
      url: `https://www.instagram.com/p/${post.code || post.shortcode}/`,
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

  public async getPosts(
    username: string,
    limit: number = 20
  ): Promise<ScraperResponse> {
    try {
      if (!username) {
        return {
          success: false,
          error: 'Username is required',
        };
      }

      await this.delay();

      const data = await this.fetchFromApi(username);

      if (!data?.data?.user) {
        throw ScrapeError.profileNotFound(username);
      }

      const posts =
        data.data.user.edge_owner_to_timeline_media?.edges?.map(
          (edge: any) => edge.node
        ) || [];

      const processedPosts: InstagramPost[] = [];

      for (const post of posts.slice(0, limit)) {
        await this.delay(1000, 2000);
        const processedPost = await this.processPost(post);
        processedPosts.push(processedPost);
      }

      return {
        success: true,
        username,
        posts: processedPosts,
        scraped_at: new Date().toISOString(),
      };
    } catch (error) {
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
        error:
          error instanceof Error ? error.message : 'Unknown error occurred',
        code: 'UNKNOWN_ERROR',
      };
    }
  }

  public async saveToJson(
    data: ScraperResponse,
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
