export interface MediaItem {
  url: string;
  type: 'image' | 'video' | 'thumbnail';
  width?: number;
  height?: number;
}

export interface InstagramPost {
  id: string;
  shortcode: string;
  timestamp: number;
  display_url: string;
  caption: string;
  likes: number;
  comments: number;
  is_video: boolean;
  url: string;
  media_type: 'image' | 'video' | 'carousel';
  media_items: MediaItem[];
  video_url?: string;
  thumbnail_url?: string;
}

export interface InstagramProfile {
  id: string;
  username: string;
  full_name: string;
  biography: string;
  external_url: string | null;
  profile_pic_url: string;
  followers: number;
  following: number;
  posts_count: number;
  is_private: boolean;
  is_verified: boolean;
  is_business_account: boolean;
  category: string | null;
}

export interface ScraperConfig {
  maxRetries?: number;
  minDelay?: number;
  maxDelay?: number;
  timeout?: number;
  rateLimitPerMinute?: number;
}

export interface GetPostsOptions {
  signal?: AbortSignal;
  onProgress?: (progress: {
    fetched: number;
    total: number;
    currentPost: InstagramPost;
  }) => void;
}

interface BaseResponse {
  success: boolean;
  scraped_at?: string;
  error?: string;
  code?: string;
  statusCode?: number;
}

export interface ScraperResponse extends BaseResponse {
  username?: string;
  posts?: InstagramPost[];
}

export interface ProfileResponse extends BaseResponse {
  profile?: InstagramProfile;
}

export interface PostResponse extends BaseResponse {
  post?: InstagramPost;
}

export type ErrorCode =
  | 'RATE_LIMITED'
  | 'PROFILE_NOT_FOUND'
  | 'POST_NOT_FOUND'
  | 'PARSE_ERROR'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'ABORTED'
  | 'ACCESS_DENIED'
  | 'SERVER_ERROR'
  | 'INVALID_CONFIG';
