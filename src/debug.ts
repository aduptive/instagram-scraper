import axios from 'axios';
import { InstagramScraper } from './scraper';

async function debugScraper(): Promise<void> {
  try {
    console.log('Starting detailed test...');

    const scraper = new InstagramScraper({
      minDelay: 0,
      maxDelay: 0,
    });

    // Direct request to check Instagram's response
    const response = await axios.get('https://www.instagram.com/instagram/', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Mobile Safari/537.36 Instagram 269.0.0.18.75',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        Connection: 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
    });

    console.log('\n=== Response Status ===');
    console.log('Status:', response.status);
    console.log('Headers:', JSON.stringify(response.headers, null, 2));

    console.log('\n=== First 1000 characters of HTML ===');
    console.log(response.data.substring(0, 1000));

    console.log('\n=== Searching for scripts in HTML ===');
    const scriptMatch: RegExpMatchArray | null = response.data.match(
      /<script[^>]*>([^<]+)<\/script>/g
    );
    if (scriptMatch) {
      console.log(`Found ${scriptMatch.length} scripts`);
      console.log('\nFirst 3 scripts:');
      scriptMatch.slice(0, 3).forEach((script: string, index: number) => {
        console.log(`\nScript ${index + 1}:`);
        console.log(script.substring(0, 200) + '...');
      });

      // Look specifically for Instagram data
      const sharedDataScript = scriptMatch.find((script: string) =>
        script.includes('window._sharedData')
      );

      if (sharedDataScript) {
        console.log('\n=== Found script with _sharedData ===');
        console.log(sharedDataScript.substring(0, 500) + '...');
      } else {
        console.log('\nNo script with _sharedData found');
      }
    } else {
      console.log('No scripts found');
    }

    // Search for other possible data sources
    console.log('\n=== Looking for other data sources ===');
    const alternativePatterns = [
      'window.__additionalDataLoaded',
      'window.__initialData',
      '<script type="application/ld+json"',
      'data-page-id',
    ];

    alternativePatterns.forEach((pattern: string) => {
      if (response.data.includes(pattern)) {
        console.log(`Found pattern: ${pattern}`);
        // Show context around the pattern
        const index = response.data.indexOf(pattern);
        const context = response.data.substring(
          Math.max(0, index - 100),
          Math.min(response.data.length, index + 300)
        );
        console.log('Context:', context);
      }
    });

    // Try normal scraper request
    console.log('\n=== Trying normal scraper ===');
    const result = await scraper.getPosts('instagram');

    // Save results to files
    if (result.success) {
      await scraper.saveToJson(result, 'test_output.json');
      await scraper.saveToJson(
        {
          success: true,
          processed_posts: result.processed_posts,
        },
        'test.json'
      );
      console.log('JSON files generated successfully!');
    }

    console.log('Result:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('\n=== Error during test ===');
    if (axios.isAxiosError(error)) {
      console.error('Axios Error:', {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        headers: error.response?.headers,
        data: error.response?.data
          ? error.response.data.substring(0, 1000)
          : null,
      });
    } else {
      console.error('Error:', error);
    }
  }
}

// Run the test
debugScraper().catch(console.error);
