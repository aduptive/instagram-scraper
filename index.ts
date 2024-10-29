import { ScrapeError } from './src';
import { InstagramScraper } from './src/scraper';

const scraper = new InstagramScraper({
  minDelay: 2000,
  maxDelay: 5000,
});

async function main() {
  try {
    const result = await scraper.getPosts('username', 20);
    if (result.success) {
      console.log(`Collected ${result.posts?.length} posts`);
    } else {
      console.error('Error:', result.error);
    }
  } catch (error) {
    if (error instanceof ScrapeError) {
      console.error('Scraping error:', error.message, error.code);
    } else {
      console.error('Unknown error:', error);
    }
  }
}
