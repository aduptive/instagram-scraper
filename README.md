# Instagram Scraper

A lightweight TypeScript library for scraping public Instagram profiles without authentication. This tool allows you to fetch recent posts from any public Instagram profile while respecting rate limits and implementing best practices for web scraping.

## Features

- 🚫 No authentication required
- 📱 Mobile-first approach for better reliability
- 🔄 Random delays and mobile user agents rotation
- ⚡ Lightweight and easy to use
- 📦 Written in TypeScript with full type support
- 🛡️ Built-in rate limiting and error handling
- 💾 JSON export functionality

## Installation

```bash
npm install @aduptive/instagram-scraper
```

## Usage

### Basic Usage

```typescript
import { InstagramScraper } from '@aduptive/instagram-scraper';

async function main() {
  const scraper = new InstagramScraper();
  
  try {
    // Get the last 20 posts from a public profile
    const results = await scraper.getPosts('instagram', 20);
    
    if (results.success && results.posts) {
      console.log(`Successfully collected ${results.posts.length} posts`);
      // Save to JSON file
      await scraper.saveToJson(results);
    } else {
      console.error('Error:', results.error);
    }
  } catch (error) {
    console.error('Critical error:', error);
  }
}

main();
```

### With Configuration

```typescript
const scraper = new InstagramScraper({
  maxRetries: 3,
  minDelay: 2000,
  maxDelay: 5000,
  timeout: 10000,
  rateLimitPerMinute: 20
});
```

### Multiple Profiles

```typescript
async function scrapeMultipleProfiles(usernames: string[]) {
  const scraper = new InstagramScraper();
  
  for (const username of usernames) {
    try {
      // Random delay between requests (2-5 seconds)
      await new Promise(resolve => 
        setTimeout(resolve, 2000 + Math.random() * 3000)
      );
      
      const results = await scraper.getPosts(username, 20);
      if (results.success) {
        console.log(`${username}: ${results.posts?.length} posts collected`);
      } else {
        console.log(`${username}: ${results.error}`);
      }
    } catch (error) {
      console.error(`Error collecting ${username}:`, error);
    }
  }
}
```

### Error Handling

```typescript
import { InstagramScraper, ScrapeError } from '@aduptive/instagram-scraper';

try {
  const results = await scraper.getPosts('username');
  if (!results.success) {
    console.error('Failed:', results.error);
    return;
  }
  // Handle success...
} catch (error) {
  if (error instanceof ScrapeError) {
    console.error(`Scraping error: ${error.message} (${error.code})`);
  } else {
    console.error('Unknown error:', error);
  }
}
```

## Configuration Options

```typescript
interface ScraperConfig {
  maxRetries?: number;      // Maximum number of retry attempts (default: 3)
  minDelay?: number;        // Minimum delay between requests in ms (default: 1000)
  maxDelay?: number;        // Maximum delay between requests in ms (default: 3000)
  timeout?: number;         // Request timeout in ms (default: 10000)
  rateLimitPerMinute?: number; // Maximum requests per minute (default: 30)
}
```

## Best Practices

1. **Rate Limiting**: The tool implements built-in delays, but you should still be mindful of Instagram's rate limits
2. **Error Handling**: Always implement proper error handling as shown in the examples
3. **Delays**: Use appropriate delays between requests to avoid being blocked
4. **User Agents**: The tool rotates mobile user agents automatically

## Known Limitations

- Works only with public Instagram profiles
- Limited to basic post information available on the profile page
- Instagram may change their HTML structure at any time
- Rate limiting may apply

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Disclaimer

This tool is provided for educational purposes only. Make sure to read and comply with Instagram's terms of service and robots.txt file. The authors are not responsible for any misuse of this tool.

## Support

If you found this project helpful, please consider giving it a ⭐️!