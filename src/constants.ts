import { ScraperConfig } from './types';

export const MOBILE_USER_AGENTS = [
  'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Mobile Safari/537.36 Instagram 269.0.0.18.75',
  'Mozilla/5.0 (Linux; Android 12; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.104 Mobile Safari/537.36 Instagram 216.1.0.21.137',
  'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/97.0.4692.87 Mobile Safari/537.36 Instagram 217.0.0.27.359',
];

export const DEFAULT_CONFIG: Required<ScraperConfig> = {
  maxRetries: 3,
  minDelay: 1000,
  maxDelay: 3000,
  timeout: 10000,
  rateLimitPerMinute: 30,
};
