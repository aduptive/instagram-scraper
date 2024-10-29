import { InstagramScraper } from '../src';

async function example() {
  // Create scraper instance
  const scraper = new InstagramScraper({
    minDelay: 1000,
    maxDelay: 3000,
    rateLimitPerMinute: 20,
  });

  try {
    // Fetch posts
    const result = await scraper.getPosts('instagram', 5);

    if (result.success && result.posts) {
      console.log(`Found ${result.posts.length} posts\n`);

      // Display information for each post
      for (const post of result.posts) {
        console.log(`Post: ${post.shortcode}`);
        console.log(`Type: ${post.media_type}`);
        console.log(`Caption: ${post.caption.substring(0, 100)}...`);
        console.log('Media:');

        post.media_items.forEach((media, index) => {
          console.log(`  ${index + 1}. ${media.type}: ${media.url}`);
          if (media.width && media.height) {
            console.log(`     Dimensions: ${media.width}x${media.height}`);
          }
        });

        console.log(`Likes: ${post.likes}`);
        console.log(`Comments: ${post.comments}`);
        console.log('---\n');
      }

      // Save result to JSON
      await scraper.saveToJson(result, 'instagram_posts.json');
    } else {
      console.error('Error:', result.error);
    }
  } catch (error) {
    console.error('Critical error:', error);
  }
}

example();
