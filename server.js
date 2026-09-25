const http = require('http');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const PORT = Number(process.env.PORT) || 3030;
const PUBLIC_DIR = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4'
};

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * Resolves short links (like pin.it) to full canonical Pinterest URL
 */
async function resolveUrl(inputUrl) {
  let currentUrl = inputUrl.trim();
  if (!currentUrl.startsWith('http://') && !currentUrl.startsWith('https://')) {
    currentUrl = 'https://' + currentUrl;
  }

  // If already pinimg, return as is
  if (currentUrl.includes('pinimg.com')) {
    return currentUrl;
  }

  try {
    const res = await fetch(currentUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
    return res.url || currentUrl;
  } catch (e) {
    return currentUrl;
  }
}

/**
 * Extracts pin ID from Pinterest URL
 */
function extractPinId(pinUrl) {
  const match = pinUrl.match(/\/pin\/(\d+)/i);
  return match ? match[1] : null;
}

/**
 * Parses raw HTML string from Pinterest pin page
 */
function parsePinterestHtml(html, originalUrl = '') {
  const cleanHtml = html.replace(/\\\//g, '/');

  let title = '';
  let description = '';
  let images = [];
  let videos = [];

  // Extract meta title and description
  const titleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
                     html.match(/<meta[^>]*name=["']twitter:title["'][^>]*content=["']([^"']+)["']/i) ||
                     html.match(/<title>([^<]+)<\/title>/i);
  if (titleMatch) title = titleMatch[1].replace(/&amp;/g, '&').replace(/\| Pinterest$/i, '').trim();

  const descMatch = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i) ||
                    html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
  if (descMatch) description = descMatch[1].replace(/&amp;/g, '&').trim();

  // 1. Try __PWS_INITIAL_PROPS__
  const initialPropsMatch = html.match(/<script\s+id=["']__PWS_INITIAL_PROPS__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (initialPropsMatch) {
    try {
      const data = JSON.parse(initialPropsMatch[1]);
      const resources = data?.initialReduxState?.resources?.PinResource || {};
      for (const key of Object.keys(resources)) {
        const pinData = resources[key]?.data;
        if (pinData) {
          extractFromPinObject(pinData, images, videos);
        }
      }

      // Check initialReduxState.pins
      const pins = data?.initialReduxState?.pins || {};
      for (const pinId of Object.keys(pins)) {
        extractFromPinObject(pins[pinId], images, videos);
      }
    } catch (e) {
      console.warn('Failed to parse __PWS_INITIAL_PROPS__', e.message);
    }
  }

  // 2. Try __PWS_DATA__
  const pwsDataMatch = html.match(/<script\s+id=["']__PWS_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (pwsDataMatch) {
    try {
      const data = JSON.parse(pwsDataMatch[1]);
      const pins = data?.props?.initialReduxState?.pins || {};
      for (const pinId of Object.keys(pins)) {
        extractFromPinObject(pins[pinId], images, videos);
      }
    } catch (e) {
      console.warn('Failed to parse __PWS_DATA__', e.message);
    }
  }

  // 3. Try JSON-LD Schema
  const jsonLdMatch = html.match(/<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
  if (jsonLdMatch) {
    try {
      const ld = JSON.parse(jsonLdMatch[1]);
      if (ld.image) {
        const imgUrl = typeof ld.image === 'string' ? ld.image : ld.image.url;
        if (imgUrl) addImageCandidate(imgUrl, 'Original HD (Schema)', images);
      }
      if (ld.video && ld.video.contentUrl) {
        addVideoCandidate(ld.video.contentUrl, 'HD Video (Schema)', ld.video.thumbnailUrl || '', videos);
      }
    } catch (e) {}
  }

  // 4. Meta tags (OpenGraph / Twitter)
  const ogVideoMatch = html.match(/<meta[^>]*property=["']og:video(?::secure_url)?["'][^>]*content=["']([^"']+)["']/i) ||
                       html.match(/<meta[^>]*name=["']twitter:player:stream["'][^>]*content=["']([^"']+)["']/i);
  if (ogVideoMatch && ogVideoMatch[1]) {
    addVideoCandidate(ogVideoMatch[1], 'HD Video (MP4)', '', videos);
  }

  const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
                       html.match(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i);
  if (ogImageMatch && ogImageMatch[1]) {
    addImageCandidate(ogImageMatch[1], 'Original HD', images);
  }

  // 5. Scan cleaned HTML for direct MP4 and original images
  const mp4Matches = cleanHtml.match(/https:\/\/(?:v|v1)\.pinimg\.com\/videos\/[^\s"'<>]+\.mp4/gi) || [];
  for (const m of mp4Matches) {
    addVideoCandidate(m, 'HD Video (MP4)', '', videos);
  }

  // Scan for originals or high-res images
  const imgMatches = cleanHtml.match(/https:\/\/i\.pinimg\.com\/(?:originals|\d+x)\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp)/gi) || [];
  for (const m of imgMatches) {
    addImageCandidate(m, 'Original 4K Image', images);
  }

  // Deduplicate and prioritize
  const dedupedImages = deduplicateBy(images, 'url');
  const dedupedVideos = deduplicateBy(videos, 'url');

  if (dedupedVideos.length > 0) {
    return {
      type: 'video',
      title: title || 'Pinterest Video',
      description,
      primaryUrl: dedupedVideos[0].url,
      thumbnail: dedupedVideos[0].thumbnail || (dedupedImages[0]?.url || ''),
      quality: dedupedVideos[0].quality,
      videos: dedupedVideos,
      images: dedupedImages,
      filename: `GetNow_Pinterest_Video_${Date.now()}.mp4`
    };
  }

  if (dedupedImages.length > 0) {
    return {
      type: 'image',
      title: title || 'Pinterest Image',
      description,
      primaryUrl: dedupedImages[0].url,
      thumbnail: dedupedImages[0].url,
      quality: dedupedImages[0].quality,
      images: dedupedImages,
      filename: `GetNow_Pinterest_Image_${Date.now()}.jpg`
    };
  }

  throw new Error('No downloadable video or image found for this pin.');
}

function extractFromPinObject(pin, images, videos) {
  if (!pin) return;

  // Videos
  if (pin.videos && pin.videos.video_list) {
    const list = pin.videos.video_list;
    const qualities = [
      { key: 'V_720P', label: '720p HD Video' },
      { key: 'V_EXP7', label: 'HD Video' },
      { key: 'V_HLSV4', label: 'HLS Stream' },
      { key: 'V_HLSV3', label: 'HLS Stream' },
      { key: 'V_480P', label: '480p Video' }
    ];

    for (const q of qualities) {
      if (list[q.key] && list[q.key].url) {
        let vidUrl = list[q.key].url;
        if (vidUrl.includes('.m3u8')) {
          // Attempt conversion to direct mp4 link
          const mp4Url = vidUrl.replace('/hls/', '/mc/').replace('.m3u8', '.mp4');
          addVideoCandidate(mp4Url, q.label + ' (MP4)', pin.images?.orig?.url || '', videos);
        }
        addVideoCandidate(vidUrl, q.label, pin.images?.orig?.url || '', videos);
      }
    }

    // Any other video entries
    for (const k of Object.keys(list)) {
      if (list[k] && list[k].url) {
        addVideoCandidate(list[k].url, `${k} Video`, pin.images?.orig?.url || '', videos);
      }
    }
  }

  // Story pin videos
  if (pin.story_pin_data && pin.story_pin_data.pages) {
    for (const page of pin.story_pin_data.pages) {
      if (page.blocks) {
        for (const block of page.blocks) {
          if (block.video && block.video.video_list) {
            for (const vKey of Object.keys(block.video.video_list)) {
              const v = block.video.video_list[vKey];
              if (v && v.url) {
                addVideoCandidate(v.url, `Story Video (${vKey})`, '', videos);
              }
            }
          }
        }
      }
    }
  }

  // Images
  if (pin.images) {
    if (pin.images.orig && pin.images.orig.url) {
      addImageCandidate(pin.images.orig.url, 'Original HD / 4K', images, pin.images.orig.width, pin.images.orig.height);
    }
    for (const size of ['736x', '564x', '474x', '236x']) {
      if (pin.images[size] && pin.images[size].url) {
        addImageCandidate(pin.images[size].url, `${size} Preview`, images);
      }
    }
  }
}

function addImageCandidate(imgUrl, quality, list, width = 0, height = 0) {
  if (!imgUrl || !imgUrl.startsWith('http')) return;
  const clean = imgUrl.replace(/&amp;/g, '&').trim();
  // Ensure we also offer the full uncompressed original
  const orig = clean.replace(/\/(?:\d+x|originals)\//, '/originals/');
  list.push({
    url: orig,
    quality: width && height ? `${quality} (${width}x${height})` : quality,
    dimensions: width && height ? `${width}x${height}` : null
  });
}

function addVideoCandidate(vidUrl, quality, thumb, list) {
  if (!vidUrl || !vidUrl.startsWith('http')) return;
  const clean = vidUrl.replace(/&amp;/g, '&').trim();
  list.push({
    url: clean,
    quality,
    thumbnail: thumb
  });
}

function deduplicateBy(arr, key) {
  const seen = new Set();
  return arr.filter(item => {
    if (seen.has(item[key])) return false;
    seen.add(item[key]);
    return true;
  });
}

/**
 * Main HTTP Server Request Handler
 */
const server = http.createServer(async (req, res) => {
  // Enable CORS headers for all requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = reqUrl.pathname;

  // Healthcheck endpoint
  if (pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', version: '2.0.0', uptime: process.uptime() }));
    return;
  }

  // 1. API Endpoint: /api/extract?url=...
  if (pathname === '/api/extract') {
    const targetUrl = reqUrl.searchParams.get('url');
    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing "url" query parameter.' }));
      return;
    }

    try {
      const resolved = await resolveUrl(targetUrl);

      // Check if it's a direct pinimg link
      if (resolved.includes('pinimg.com')) {
        if (resolved.includes('/videos/') || resolved.endsWith('.mp4')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            type: 'video',
            title: 'Pinterest Video',
            primaryUrl: resolved,
            thumbnail: '',
            quality: 'HD Video (MP4)',
            videos: [{ url: resolved, quality: 'HD Video (MP4)' }],
            images: [],
            filename: `GetNow_Pinterest_Video_${Date.now()}.mp4`
          }));
          return;
        }

        // Direct image
        const origImg = resolved.replace(/\/(?:\d+x|originals)\//, '/originals/');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          type: 'image',
          title: 'Pinterest Image',
          primaryUrl: origImg,
          thumbnail: origImg,
          quality: 'Original HD / 4K',
          images: [{ url: origImg, quality: 'Original HD / 4K' }],
          filename: `GetNow_Pinterest_Image_${Date.now()}.jpg`
        }));
        return;
      }

      // Fetch the Pinterest page
      const response = await fetch(resolved, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'x-pinterest-pws-handler': 'www/pin/[id].js'
        }
      });

      if (!response.ok) {
        throw new Error(`Pinterest returned status ${response.status}`);
      }

      const html = await response.text();
      const mediaData = parsePinterestHtml(html, resolved);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(mediaData));
    } catch (err) {
      console.error('Extraction error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: err.message || 'Failed to extract Pinterest media.',
        tip: 'Try copying the direct image or video address from Pinterest, or paste the pin page HTML.'
      }));
    }
    return;
  }

  // 2. API Endpoint: /api/download?url=...&filename=...
  if (pathname === '/api/download') {
    const fileUrl = reqUrl.searchParams.get('url');
    const filename = reqUrl.searchParams.get('filename') || `Pinterest_${Date.now()}.jpg`;

    if (!fileUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing "url" parameter.' }));
      return;
    }

    try {
      const mediaRes = await fetch(fileUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          'Referer': 'https://www.pinterest.com/'
        }
      });

      if (!mediaRes.ok) {
        throw new Error(`Media fetch failed with status: ${mediaRes.status}`);
      }

      const contentType = mediaRes.headers.get('content-type') || 'application/octet-stream';
      const contentLength = mediaRes.headers.get('content-length');

      const headers = {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
        'Access-Control-Allow-Origin': '*'
      };
      if (contentLength) headers['Content-Length'] = contentLength;

      res.writeHead(200, headers);

      if (mediaRes.body) {
        Readable.fromWeb(mediaRes.body).pipe(res);
      } else {
        res.end();
      }
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Download failed: ${e.message}` }));
    }
    return;
  }

  // 3. Static Files Serving
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

  // Security check: prevent directory traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

function startServer(port = PORT) {
  const s = server.listen(port, () => {
    console.log(`⚡ GetNow server running at http://localhost:${port}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${port} is in use, trying ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('Server error:', err);
    }
  });

  return s;
}

if (require.main === module) {
  startServer(PORT);
}

module.exports = { server, startServer, resolveUrl, parsePinterestHtml };
