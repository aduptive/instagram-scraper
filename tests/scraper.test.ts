import { tmpdir } from 'os';
import { join } from 'path';
import { InstagramScraper } from '../src';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  };
}

const profileData = {
  data: {
    user: {
      id: '42',
      username: 'testuser',
      full_name: 'Test User',
      biography: 'a bio',
      external_url: 'https://example.com',
      profile_pic_url: 'https://example.com/pic.jpg',
      is_private: false,
      is_verified: true,
      edge_followed_by: { count: 1000 },
      edge_follow: { count: 150 },
      edge_owner_to_timeline_media: {
        count: 300,
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
};

const mediaData = {
  items: [
    {
      id: '123',
      code: 'ABC123',
      taken_at: 1234567890,
      caption: { text: 'Test caption' },
      like_count: 100,
      comment_count: 50,
      image_versions2: {
        candidates: [
          { url: 'https://example.com/image.jpg', width: 1080, height: 1080 },
        ],
      },
    },
  ],
};

describe('InstagramScraper', () => {
  let scraper: InstagramScraper;

  beforeEach(() => {
    jest.clearAllMocks();
    scraper = new InstagramScraper({ minDelay: 0, maxDelay: 0 });
  });

  it('should create an instance', () => {
    expect(scraper).toBeInstanceOf(InstagramScraper);
  });

  it('should handle empty username', async () => {
    const result = await scraper.getPosts('');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Username is required');
  });

  it('should fetch posts', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(profileData))
      .mockResolvedValueOnce(jsonResponse(mediaData));

    const result = await scraper.getPosts('testuser');

    expect(result.success).toBe(true);
    expect(result.posts?.[0]).toMatchObject({
      id: '123',
      shortcode: 'ABC123',
      caption: 'Test caption',
      likes: 100,
      comments: 50,
      media_type: 'image',
    });
  });

  it('should report progress', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(profileData))
      .mockResolvedValueOnce(jsonResponse(mediaData));

    const onProgress = jest.fn();
    await scraper.getPosts('testuser', 20, { onProgress });

    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ fetched: 1, total: 1 })
    );
  });

  it('should abort via AbortSignal', async () => {
    mockFetch.mockResolvedValue(jsonResponse(profileData));

    const controller = new AbortController();
    controller.abort();
    const result = await scraper.getPosts('testuser', 20, {
      signal: controller.signal,
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('ABORTED');
    expect(result.posts).toEqual([]);
  });

  it('should fetch a profile', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(profileData));

    const result = await scraper.getProfile('testuser');

    expect(result.success).toBe(true);
    expect(result.profile).toMatchObject({
      username: 'testuser',
      followers: 1000,
      following: 150,
      posts_count: 300,
      is_verified: true,
    });
  });

  it('should fetch a single post from a URL', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(mediaData));

    const result = await scraper.getPost(
      'https://www.instagram.com/reel/ABC123/'
    );

    expect(result.success).toBe(true);
    expect(result.post).toMatchObject({
      shortcode: 'ABC123',
      caption: 'Test caption',
      likes: 100,
    });
    expect(mockFetch.mock.calls[0][0]).toContain('/media/ABC123/info/');
  });

  it('should reject an invalid post URL', async () => {
    const result = await scraper.getPost('https://example.com/not-a-post');
    expect(result.success).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should retry transient errors then fail', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, 500));

    const result = await scraper.getPosts('testuser');

    expect(result.success).toBe(false);
    expect(result.code).toBe('SERVER_ERROR');
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('should not retry 404s', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, 404));

    const result = await scraper.getPosts('nonexistentuser');

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should save to JSON', async () => {
    const mockData = {
      success: true,
      username: 'instagram',
      posts: [],
      scraped_at: new Date().toISOString(),
    };

    const result = await scraper.saveToJson(
      mockData,
      join(tmpdir(), 'instagram-scraper-test.json')
    );
    expect(result).toBe(true);
  });
});
