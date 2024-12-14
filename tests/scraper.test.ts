import axios from 'axios';
import { InstagramScraper } from '../src';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('InstagramScraper', () => {
  let scraper: InstagramScraper;

  beforeEach(() => {
    jest.clearAllMocks();
    scraper = new InstagramScraper({
      minDelay: 0,
      maxDelay: 0,
    });
    mockedAxios.create.mockReturnValue(mockedAxios);
  });

  it('should create an instance', () => {
    expect(scraper).toBeInstanceOf(InstagramScraper);
  });

  it('should handle empty username', async () => {
    const result = await scraper.getPosts('');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Username is required');
  });

  it('should handle successful response', async () => {
    // Mock the profile API response
    mockedAxios.get.mockImplementationOnce(() =>
      Promise.resolve({
        data: {
          data: {
            user: {
              edge_owner_to_timeline_media: {
                edges: [
                  {
                    node: {
                      id: '123',
                      shortcode: 'ABC123',
                      taken_at_timestamp: 1234567890,
                      display_url: 'https://example.com/image.jpg',
                      edge_media_to_caption: {
                        edges: [{ node: { text: 'Test caption' } }],
                      },
                      edge_liked_by: { count: 100 },
                      edge_media_to_comment: { count: 50 },
                      is_video: false,
                    },
                  },
                ],
              },
            },
          },
        },
      })
    );

    // Mock the media API response
    mockedAxios.get.mockImplementationOnce(() =>
      Promise.resolve({
        data: {
          items: [
            {
              image_versions2: {
                candidates: [
                  {
                    url: 'https://example.com/image.jpg',
                    width: 1080,
                    height: 1080,
                  },
                ],
              },
            },
          ],
        },
      })
    );

    const result = await scraper.getPosts('testuser');

    expect(result.success).toBe(true);
    if (result.posts) {
      expect(result.posts[0]).toMatchObject({
        id: '123',
        shortcode: 'ABC123',
        caption: 'Test caption',
        likes: 100,
        comments: 50,
      });
    }
  });

  it('should handle network error', async () => {
    const networkError = new Error('Network Error');
    (networkError as any).isAxiosError = true;
    mockedAxios.get.mockRejectedValueOnce(networkError);

    const result = await scraper.getPosts('testuser');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Network');
  });

  it('should handle profile not found', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        data: {
          user: null,
        },
      },
    });

    const result = await scraper.getPosts('nonexistentuser');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('should save to JSON', async () => {
    const mockData = {
      success: true,
      username: 'instagram',
      posts: [],
      scraped_at: new Date().toISOString(),
    };

    const result = await scraper.saveToJson(mockData, 'test.json');
    expect(result).toBe(true);
  });
});
