import { InstagramScraper } from './scraper';

export { ScrapeError } from './errors';
export { InstagramScraper } from './scraper';
export type {
  ErrorCode,
  GetPostsOptions,
  InstagramPost,
  InstagramProfile,
  MediaItem,
  PostResponse,
  ProfileResponse,
  ScraperConfig,
  ScraperResponse,
} from './types';

export default InstagramScraper;
export const VERSION = '2.0.0';
