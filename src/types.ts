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

export interface ScraperConfig {
  maxRetries?: number;
  minDelay?: number;
  maxDelay?: number;
  timeout?: number;
  rateLimitPerMinute?: number;
}

export interface ScraperResponse {
  success: boolean;
  username?: string;
  posts?: InstagramPost[];
  scraped_at?: string;
  error?: string;
  code?: string;
  statusCode?: number;
}

// Tipos de erro possíveis para melhor tipagem
export type ErrorCode =
  | 'RATE_LIMITED'
  | 'PROFILE_NOT_FOUND'
  | 'PARSE_ERROR'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'ACCESS_DENIED'
  | 'SERVER_ERROR'
  | 'INVALID_CONFIG';
