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
    // ABC123 converted from shortcode (base64url) to the numeric media id
    expect(mockFetch.mock.calls[0][0]).toMatch(/\/media\/\d+\/info\//);
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

  it('should not fetch at all with a pre-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();

    const profile = await scraper.getProfile('testuser', {
      signal: controller.signal,
    });
    const post = await scraper.getPost('ABC123', {
      signal: controller.signal,
    });

    expect(profile.success).toBe(false);
    expect(profile.code).toBe('ABORTED');
    expect(post.success).toBe(false);
    expect(post.code).toBe('ABORTED');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should stop the collection when media enrichment hits a 429', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(profileData))
      .mockResolvedValue(jsonResponse({}, 429));

    const result = await scraper.getPosts('testuser');

    expect(result.success).toBe(false);
    expect(result.code).toBe('RATE_LIMITED');
    // profile + one media attempt; the block is reported, not hidden
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should classify carousels from structural fields when enrichment fails', async () => {
    const sidecarProfile = JSON.parse(JSON.stringify(profileData));
    const node =
      sidecarProfile.data.user.edge_owner_to_timeline_media.edges[0].node;
    node.__typename = 'GraphSidecar';
    node.edge_sidecar_to_children = {
      edges: [
        { node: { display_url: 'https://example.com/a.jpg' } },
        { node: { display_url: 'https://example.com/b.jpg' } },
      ],
    };

    mockFetch
      .mockResolvedValueOnce(jsonResponse(sidecarProfile))
      .mockResolvedValue(jsonResponse({}, 500));

    const result = await scraper.getPosts('testuser');

    expect(result.success).toBe(true);
    expect(result.posts?.[0].media_type).toBe('carousel');
    expect(result.posts?.[0].media_items).toHaveLength(2);
  });

  it('should report invalid JSON as PARSE_ERROR without retrying', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    });

    const result = await scraper.getProfile('testuser');

    expect(result.success).toBe(false);
    expect(result.code).toBe('PARSE_ERROR');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should reject a non-positive limit', async () => {
    const result = await scraper.getPosts('testuser', -1);
    expect(result.success).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should reject an invalid config', () => {
    expect(() => new InstagramScraper({ rateLimitPerMinute: 0 })).toThrow(
      'Invalid configuration'
    );
    expect(() => new InstagramScraper({ minDelay: 500, maxDelay: 100 })).toThrow(
      'Invalid configuration'
    );
  });

  it('should ignore explicitly undefined config values', () => {
    expect(() => new InstagramScraper({ timeout: undefined })).not.toThrow();
  });

  it('should convert the shortcode to the exact numeric media id', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(mediaData));
    await scraper.getPost('ABC123');
    // independently verified: base64url('ABC123') === 17522103
    expect(mockFetch.mock.calls[0][0]).toContain('/media/17522103/info/');
  });

  it('should report ABORTED when cancelled while reading a response body', async () => {
    const controller = new AbortController();
    mockFetch.mockImplementation(async (url: string) => {
      if (String(url).includes('/media/')) {
        controller.abort();
        return {
          ok: true,
          status: 200,
          json: async () => {
            const error = new Error('This operation was aborted');
            error.name = 'AbortError';
            throw error;
          },
        };
      }
      return jsonResponse(profileData);
    });

    const result = await scraper.getPosts('testuser', 20, {
      signal: controller.signal,
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('ABORTED');
  });

  it('should not fabricate video_url from a cover image', async () => {
    const videoProfile = JSON.parse(JSON.stringify(profileData));
    videoProfile.data.user.edge_owner_to_timeline_media.edges[0].node.is_video =
      true;

    mockFetch
      .mockResolvedValueOnce(jsonResponse(videoProfile))
      .mockResolvedValue(jsonResponse({}, 500));

    const result = await scraper.getPosts('testuser');

    expect(result.success).toBe(true);
    const post = result.posts?.[0];
    expect(post?.media_type).toBe('video');
    expect(post?.video_url).toBeUndefined();
    expect(post?.thumbnail_url).toBe('https://example.com/image.jpg');
  });

  it('should reject NaN, Infinity and fractional config values', () => {
    expect(() => new InstagramScraper({ maxRetries: NaN })).toThrow();
    expect(() => new InstagramScraper({ maxRetries: Infinity })).toThrow();
    expect(() => new InstagramScraper({ maxRetries: 1.5 })).toThrow();
    expect(() => new InstagramScraper({ timeout: NaN })).toThrow();
    expect(() => new InstagramScraper({ rateLimitPerMinute: NaN })).toThrow();
  });

  it('should serialize concurrent callers through the rate limit', async () => {
    jest.useFakeTimers();
    try {
      const limited = new InstagramScraper({
        minDelay: 0,
        maxDelay: 0,
        rateLimitPerMinute: 1,
      });
      const released: number[] = [];
      const throttle = () =>
        (limited as any).throttle().then(() => released.push(Date.now()));

      await throttle();
      const pending = [throttle(), throttle()];
      await jest.advanceTimersByTimeAsync(180000);
      await Promise.all(pending);

      expect(released).toHaveLength(3);
      // one caller per window, not all released together
      expect(released[1] - released[0]).toBeGreaterThanOrEqual(60000);
      expect(released[2] - released[1]).toBeGreaterThanOrEqual(60000);
    } finally {
      jest.useRealTimers();
    }
  });

  it('should not query a truncated id for an overlong shortcode', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, 404));

    const result = await scraper.getPost('BAcyDyQwc8Bgarbage');

    expect(result.success).toBe(false);
    // no base64url conversion happened: the raw string was used as-is, once
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toContain('/media/BAcyDyQwc8Bgarbage/');
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
