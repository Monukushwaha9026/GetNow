/**
 * GetNow 2.0 - Pinterest Video & Image Downloader
 * Supports:
 * - Ultra-fast local / cloud backend streaming mode (zero CORS issues)
 * - Pure client-side static mode for GitHub Pages
 * - Multi-resolution quality selection (Original 4K, 736x HD, 564x, 720p MP4)
 * - Smart URL upscaler (converts thumbnails to 4K originals)
 * - Direct page-source extractor modal to bypass all CORS blocks
 */

// DOM Elements
const pinUrlInput = document.getElementById('pinUrlInput');
const pasteBtn = document.getElementById('pasteBtn');
const clearBtn = document.getElementById('clearBtn');
const fetchBtn = document.getElementById('fetchBtn');
const sampleBtn = document.getElementById('sampleBtn');
const statusMessage = document.getElementById('statusMessage');
const backendStatusTag = document.getElementById('backendStatusTag');
const backendStatusText = document.getElementById('backendStatusText');

// Result Card Elements
const resultCard = document.getElementById('resultCard');
const mediaTypeBadge = document.getElementById('mediaTypeBadge');
const mediaTypeIcon = document.getElementById('mediaTypeIcon');
const mediaTypeText = document.getElementById('mediaTypeText');
const mediaQualityTag = document.getElementById('mediaQualityTag');
const videoWrapper = document.getElementById('videoWrapper');
const videoPreview = document.getElementById('videoPreview');
const imageWrapper = document.getElementById('imageWrapper');
const imagePreview = document.getElementById('imagePreview');
const downloadBtn = document.getElementById('downloadBtn');
const downloadBtnText = document.getElementById('downloadBtnText');
const openTabBtn = document.getElementById('openTabBtn');
const copyLinkBtn = document.getElementById('copyLinkBtn');
const qualitySection = document.getElementById('qualitySection');
const qualityPills = document.getElementById('qualityPills');

// History Elements
const historySection = document.getElementById('historySection');
const historyGrid = document.getElementById('historyGrid');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');

// Modal Elements
const openModalBtn = document.getElementById('openModalBtn');
const sourceModal = document.getElementById('sourceModal');
const closeModalBtn = document.getElementById('closeModalBtn');
const modalBackdrop = document.getElementById('modalBackdrop');
const sourceInput = document.getElementById('sourceInput');
const extractSourceBtn = document.getElementById('extractSourceBtn');

// State
let hasBackend = false;
let currentMedia = null;
let selectedResolutionUrl = null;

// Verified active Pinterest sample (736x thumbnail converted to 4K original)
const SAMPLE_PIN_URL = "https://i.pinimg.com/736x/d5/3b/01/d53b014d86a6b6761bf649a0ed813c2b.png";

/* ============================================================
   Initialization & Backend Detection
   ============================================================ */
document.addEventListener('DOMContentLoaded', async () => {
  renderHistory();
  await checkBackendStatus();
});

async function checkBackendStatus() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    const res = await fetch('/api/health', { signal: controller.signal });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      if (data.status === 'ok') {
        hasBackend = true;
        backendStatusTag.className = 'header-tag server-active';
        backendStatusText.textContent = '⚡ Server Connected (Direct Save)';
        return;
      }
    }
  } catch (_) {
    // Backend not running (e.g. purely static GitHub Pages or file://)
  }

  hasBackend = false;
  backendStatusTag.className = 'header-tag client-only';
  backendStatusText.textContent = '🌐 Pure Client-Side Mode';
}

/* ============================================================
   Event Listeners
   ============================================================ */

// Input typing
pinUrlInput.addEventListener('input', () => {
  if (pinUrlInput.value.trim().length > 0) {
    clearBtn.classList.remove('hidden');
  } else {
    clearBtn.classList.add('hidden');
  }
});

// Enter key
pinUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleFetch();
});

// Clear input
clearBtn.addEventListener('click', () => {
  pinUrlInput.value = '';
  clearBtn.classList.add('hidden');
  pinUrlInput.focus();
});

// Paste from Clipboard
pasteBtn.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      pinUrlInput.value = text.trim();
      clearBtn.classList.remove('hidden');
      handleFetch();
    }
  } catch (err) {
    showStatus("Clipboard access denied by browser. Please paste manually using Ctrl+V.", "error");
  }
});

// Sample Pin
sampleBtn.addEventListener('click', () => {
  pinUrlInput.value = SAMPLE_PIN_URL;
  clearBtn.classList.remove('hidden');
  handleFetch();
});

// Fetch button
fetchBtn.addEventListener('click', handleFetch);

// Download button
downloadBtn.addEventListener('click', () => {
  if (!currentMedia) return;
  const targetUrl = selectedResolutionUrl || currentMedia.primaryUrl || currentMedia.url;
  const targetName = currentMedia.filename || `Pinterest_Download_${Date.now()}`;
  triggerDownload(targetUrl, targetName);
});

// Copy direct link
copyLinkBtn.addEventListener('click', async () => {
  const targetUrl = selectedResolutionUrl || (currentMedia && (currentMedia.primaryUrl || currentMedia.url));
  if (!targetUrl) return;
  try {
    await navigator.clipboard.writeText(targetUrl);
    const originalSvg = copyLinkBtn.innerHTML;
    copyLinkBtn.innerHTML = `✓`;
    copyLinkBtn.style.color = "var(--success)";
    setTimeout(() => {
      copyLinkBtn.innerHTML = originalSvg;
      copyLinkBtn.style.color = "";
    }, 2000);
  } catch (_) {
    showStatus("Unable to copy link to clipboard.", "error");
  }
});

// Clear history
clearHistoryBtn.addEventListener('click', () => {
  localStorage.removeItem('getnow_history');
  renderHistory();
});

// Page Source Modal
openModalBtn.addEventListener('click', () => {
  sourceModal.classList.remove('hidden');
  sourceInput.value = '';
  sourceInput.focus();
});

closeModalBtn.addEventListener('click', () => {
  sourceModal.classList.add('hidden');
});

modalBackdrop.addEventListener('click', () => {
  sourceModal.classList.add('hidden');
});

extractSourceBtn.addEventListener('click', () => {
  const html = sourceInput.value.trim();
  if (!html) {
    alert("Please paste the page source first.");
    return;
  }
  try {
    const media = parsePinterestHtml(html);
    currentMedia = media;
    selectedResolutionUrl = media.primaryUrl || media.url;
    displayResult(media);
    saveToHistory(media);
    sourceModal.classList.add('hidden');
    showStatus("✅ Successfully extracted media from pasted HTML source!", "success");
  } catch (err) {
    alert(`Could not extract media: ${err.message}`);
  }
});

/* ============================================================
   Main Extraction Pipeline
   ============================================================ */
async function handleFetch() {
  const rawUrl = pinUrlInput.value.trim();
  hideStatus();

  if (!rawUrl) {
    showStatus("Please paste a Pinterest URL first.", "error");
    return;
  }

  if (!isValidUrl(rawUrl)) {
    showStatus("Please enter a valid Pinterest link (e.g. https://pin.it/... or pinterest.com/pin/...)", "error");
    return;
  }

  setLoading(true);
  resultCard.classList.add('hidden');

  try {
    let media = null;

    // 1. If backend server is active, use it for 100% reliable direct extraction
    if (hasBackend) {
      try {
        const res = await fetch(`/api/extract?url=${encodeURIComponent(rawUrl)}`);
        const json = await res.json();
        if (res.ok && (json.primaryUrl || json.url)) {
          media = json;
        } else if (json.error) {
          throw new Error(json.error);
        }
      } catch (backendErr) {
        console.warn("Backend extract failed, falling back to client-side pipeline:", backendErr);
      }
    }

    // 2. Client-side extraction fallback
    if (!media) {
      media = await extractClientSide(rawUrl);
    }

    if (media && (media.primaryUrl || media.url)) {
      currentMedia = media;
      selectedResolutionUrl = media.primaryUrl || media.url;
      displayResult(media);
      saveToHistory(media);
    } else {
      throw new Error("Could not find downloadable media from this link.");
    }
  } catch (err) {
    console.error("Extraction error:", err);
    showStatus(
      `⚠️ <strong>Could not extract media automatically.</strong><br/>
       <div style="margin-top: 0.5rem; line-height: 1.5;">
         <strong>💡 Fix 1:</strong> On Pinterest, right-click the image or video &rarr; select <em>"Copy Image Address"</em> or <em>"Copy Video Address"</em> &rarr; paste here!<br/>
         <strong>💡 Fix 2:</strong> Click <strong>"Page Source"</strong> above to extract in 2 seconds with zero proxy blocks!
       </div>`,
      "error"
    );
  } finally {
    setLoading(false);
  }
}

/**
 * Pure client-side extraction handler
 */
async function extractClientSide(url) {
  // Strategy 1: Direct pinimg image or video URL
  if (url.includes("pinimg.com")) {
    // Check if it's a video stream
    if (url.includes("/videos/") || url.endsWith(".mp4")) {
      return {
        type: "video",
        title: "Pinterest Video",
        primaryUrl: url,
        thumbnail: "",
        quality: "HD Video (MP4)",
        videos: [{ url: url, quality: "HD Video (MP4)" }],
        images: [],
        filename: `GetNow_Pinterest_Video_${Date.now()}.mp4`
      };
    }

    // Direct Image: smart upscaler to 4K / uncompressed originals
    const originalUrl = url.replace(/\/(?:\d+x|originals)\//, "/originals/");
    return {
      type: "image",
      title: "Pinterest Image",
      primaryUrl: originalUrl,
      thumbnail: originalUrl,
      quality: "Original HD / 4K",
      images: [
        { url: originalUrl, quality: "Original HD / 4K" },
        { url: url, quality: "Standard Size" }
      ],
      filename: `GetNow_Pinterest_Image_${Date.now()}.jpg`
    };
  }

  // Strategy 2: Fetch Pin Page via CORS Proxies with individual timeouts
  const proxies = [
    async (target) => {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`https://corsproxy.org/?${encodeURIComponent(target)}`, { signal: controller.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error("corsproxy.org failed");
      return await res.text();
    },
    async (target) => {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(target)}`, { signal: controller.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error("allorigins failed");
      const data = await res.json();
      return data.contents;
    },
    async (target) => {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(target)}`, { signal: controller.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error("codetabs failed");
      return await res.text();
    }
  ];

  let html = null;
  let lastError = null;

  for (const proxy of proxies) {
    try {
      html = await proxy(url);
      if (html && html.length > 500 && (html.includes('pinimg.com') || html.includes('__PWS'))) {
        break; // Valid Pinterest HTML received
      }
    } catch (e) {
      lastError = e;
    }
  }

  if (!html || html.length < 500) {
    throw lastError || new Error("Unable to fetch page via CORS proxy.");
  }

  return parsePinterestHtml(html);
}

/**
 * Universal Pinterest HTML parser (supports modern __PWS_INITIAL_PROPS__, legacy __PWS_DATA__, Schema LD+JSON, OpenGraph, Twitter, and regex)
 */
function parsePinterestHtml(html) {
  const cleanHtml = html.replace(/\\\//g, '/');

  let title = 'Pinterest Media';
  let images = [];
  let videos = [];

  // Title
  const titleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
                     html.match(/<title>([^<]+)<\/title>/i);
  if (titleMatch) title = titleMatch[1].replace(/&amp;/g, '&').replace(/\| Pinterest$/i, '').trim();

  // 1. __PWS_INITIAL_PROPS__ (modern Pinterest hydration)
  const initialPropsMatch = html.match(/<script\s+id=["']__PWS_INITIAL_PROPS__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (initialPropsMatch) {
    try {
      const data = JSON.parse(initialPropsMatch[1]);
      const resources = data?.initialReduxState?.resources?.PinResource || {};
      for (const k of Object.keys(resources)) {
        if (resources[k]?.data) extractFromPinData(resources[k].data, images, videos);
      }
      const pins = data?.initialReduxState?.pins || {};
      for (const k of Object.keys(pins)) {
        extractFromPinData(pins[k], images, videos);
      }
    } catch (_) {}
  }

  // 2. __PWS_DATA__ (legacy Pinterest)
  const pwsMatch = html.match(/<script\s+id=["']__PWS_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (pwsMatch) {
    try {
      const data = JSON.parse(pwsMatch[1]);
      const pins = data?.props?.initialReduxState?.pins || {};
      for (const k of Object.keys(pins)) {
        extractFromPinData(pins[k], images, videos);
      }
    } catch (_) {}
  }

  // 3. Schema.org LD+JSON
  const ldMatch = html.match(/<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
  if (ldMatch) {
    try {
      const ld = JSON.parse(ldMatch[1]);
      if (ld.image) {
        const u = typeof ld.image === 'string' ? ld.image : ld.image.url;
        if (u) addImageEntry(u, 'Original HD (Schema)', images);
      }
      if (ld.video && ld.video.contentUrl) {
        addVideoEntry(ld.video.contentUrl, 'HD Video (Schema)', ld.video.thumbnailUrl || '', videos);
      }
    } catch (_) {}
  }

  // 4. OpenGraph & Twitter Meta Tags
  const ogVideo = html.match(/<meta[^>]*property=["']og:video(?::secure_url)?["'][^>]*content=["']([^"']+)["']/i) ||
                  html.match(/<meta[^>]*name=["']twitter:player:stream["'][^>]*content=["']([^"']+)["']/i);
  if (ogVideo && ogVideo[1]) addVideoEntry(ogVideo[1], 'HD Video (MP4)', '', videos);

  const ogImage = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
                  html.match(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i);
  if (ogImage && ogImage[1]) addImageEntry(ogImage[1], 'Original HD', images);

  // 5. Direct Regex Scanning (with unescaped slashes)
  const mp4s = cleanHtml.match(/https:\/\/(?:v|v1)\.pinimg\.com\/videos\/[^\s"'<>]+\.mp4/gi) || [];
  for (const m of mp4s) addVideoEntry(m, 'HD Video (MP4)', '', videos);

  const imgs = cleanHtml.match(/https:\/\/i\.pinimg\.com\/(?:originals|\d+x)\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp)/gi) || [];
  for (const m of imgs) addImageEntry(m, 'Original 4K Image', images);

  // Deduplicate
  const uniqueVideos = dedupe(videos, 'url');
  const uniqueImages = dedupe(images, 'url');

  if (uniqueVideos.length > 0) {
    return {
      type: 'video',
      title: title || 'Pinterest Video',
      primaryUrl: uniqueVideos[0].url,
      thumbnail: uniqueVideos[0].thumbnail || (uniqueImages[0]?.url || ''),
      quality: uniqueVideos[0].quality,
      videos: uniqueVideos,
      images: uniqueImages,
      filename: `GetNow_Pinterest_Video_${Date.now()}.mp4`
    };
  }

  if (uniqueImages.length > 0) {
    return {
      type: 'image',
      title: title || 'Pinterest Image',
      primaryUrl: uniqueImages[0].url,
      thumbnail: uniqueImages[0].url,
      quality: uniqueImages[0].quality,
      images: uniqueImages,
      filename: `GetNow_Pinterest_Image_${Date.now()}.jpg`
    };
  }

  throw new Error("No media stream or image found in this page.");
}

function extractFromPinData(pin, images, videos) {
  if (!pin) return;

  // Video streams
  if (pin.videos && pin.videos.video_list) {
    const list = pin.videos.video_list;
    const priority = ['V_720P', 'V_EXP7', 'V_HLSV4', 'V_480P'];
    for (const key of priority) {
      if (list[key] && list[key].url) {
        let u = list[key].url;
        if (u.includes('.m3u8')) {
          const mp4 = u.replace('/hls/', '/mc/').replace('.m3u8', '.mp4');
          addVideoEntry(mp4, `${key} HD (MP4)`, pin.images?.orig?.url || '', videos);
        }
        addVideoEntry(u, `${key} Stream`, pin.images?.orig?.url || '', videos);
      }
    }
  }

  // Images
  if (pin.images) {
    if (pin.images.orig && pin.images.orig.url) {
      const orig = pin.images.orig;
      addImageEntry(orig.url, orig.width ? `Original 4K (${orig.width}x${orig.height})` : 'Original 4K', images);
    }
    for (const sz of ['736x', '564x']) {
      if (pin.images[sz] && pin.images[sz].url) {
        addImageEntry(pin.images[sz].url, `${sz} HD`, images);
      }
    }
  }
}

function addImageEntry(url, quality, list) {
  if (!url || !url.startsWith('http')) return;
  const clean = url.replace(/&amp;/g, '&').trim();
  const orig = clean.replace(/\/(?:\d+x|originals)\//, '/originals/');
  list.push({ url: orig, quality });
}

function addVideoEntry(url, quality, thumb, list) {
  if (!url || !url.startsWith('http')) return;
  const clean = url.replace(/&amp;/g, '&').trim();
  list.push({ url: clean, quality, thumbnail: thumb });
}

function dedupe(arr, key) {
  const seen = new Set();
  return arr.filter(i => {
    if (seen.has(i[key])) return false;
    seen.add(i[key]);
    return true;
  });
}

/* ============================================================
   UI Rendering
   ============================================================ */
function displayResult(media) {
  resultCard.classList.remove('hidden');

  mediaQualityTag.textContent = media.quality;

  const isVideo = media.type === 'video';

  if (isVideo) {
    mediaTypeIcon.textContent = '🎥';
    mediaTypeText.textContent = 'Pinterest Video';
    downloadBtnText.textContent = hasBackend ? 'Download Video (Direct Save)' : 'Download HD Video (MP4)';

    imageWrapper.classList.add('hidden');
    videoWrapper.classList.remove('hidden');

    videoPreview.src = selectedResolutionUrl || media.primaryUrl || media.url;
    videoPreview.load();
  } else {
    mediaTypeIcon.textContent = '🖼️';
    mediaTypeText.textContent = 'Pinterest Image';
    downloadBtnText.textContent = hasBackend ? 'Download Image (Direct Save)' : 'Download Original 4K Image';

    videoWrapper.classList.add('hidden');
    imageWrapper.classList.remove('hidden');

    imagePreview.src = selectedResolutionUrl || media.primaryUrl || media.url;
  }

  // Render Quality Selector Pills
  renderQualityPills(media);

  // Set Direct Open link
  openTabBtn.href = selectedResolutionUrl || media.primaryUrl || media.url;

  resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderQualityPills(media) {
  const options = (media.type === 'video' ? media.videos : media.images) || [];

  if (options.length <= 1) {
    qualitySection.classList.add('hidden');
    return;
  }

  qualitySection.classList.remove('hidden');
  qualityPills.innerHTML = '';

  options.forEach((opt, idx) => {
    const pill = document.createElement('button');
    pill.className = `quality-pill ${opt.url === selectedResolutionUrl ? 'active' : ''}`;
    pill.textContent = opt.quality || `Option ${idx + 1}`;

    pill.addEventListener('click', () => {
      selectedResolutionUrl = opt.url;
      document.querySelectorAll('.quality-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');

      if (media.type === 'video') {
        videoPreview.src = opt.url;
        videoPreview.load();
      } else {
        imagePreview.src = opt.url;
      }
      openTabBtn.href = opt.url;
    });

    qualityPills.appendChild(pill);
  });
}

/* ============================================================
   File Download Handler
   ============================================================ */
async function triggerDownload(url, filename) {
  const originalText = downloadBtnText.textContent;
  downloadBtnText.textContent = "Downloading...";

  // 1. If backend server is active: direct attachment stream
  if (hasBackend) {
    try {
      const downloadApiUrl = `/api/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`;
      const link = document.createElement('a');
      link.href = downloadApiUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      downloadBtnText.textContent = "Downloaded!";
      setTimeout(() => { downloadBtnText.textContent = originalText; }, 2000);
      return;
    } catch (e) {
      console.warn("Backend stream download error, trying blob fallback:", e);
    }
  }

  // 2. Client-side fallback: Blob download
  try {
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) throw new Error("CORS or network error");

    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => URL.revokeObjectURL(blobUrl), 3000);
    downloadBtnText.textContent = "Downloaded!";
    setTimeout(() => { downloadBtnText.textContent = originalText; }, 2000);
  } catch (err) {
    // 3. If CORS blocks client-side blob reading: open direct link in a new tab
    console.warn("Direct blob download failed due to CORS, opening direct link in new tab:", err);
    window.open(url, '_blank');
    downloadBtnText.textContent = "Opened in New Tab!";
    showStatus("💡 Since your browser blocked direct saving without a backend, the file was opened in a new tab. Right-click &rarr; <em>'Save Image As...'</em> to save.", "info");
    setTimeout(() => { downloadBtnText.textContent = originalText; }, 2500);
  }
}

/* ============================================================
   History Management
   ============================================================ */
function saveToHistory(media) {
  try {
    let history = JSON.parse(localStorage.getItem('getnow_history') || '[]');
    const targetUrl = media.primaryUrl || media.url;
    history = history.filter(item => item.url !== targetUrl);
    history.unshift({
      type: media.type,
      url: targetUrl,
      thumb: media.thumbnail || targetUrl,
      filename: media.filename,
      quality: media.quality,
      date: new Date().toLocaleDateString()
    });

    if (history.length > 8) history = history.slice(0, 8);
    localStorage.setItem('getnow_history', JSON.stringify(history));
    renderHistory();
  } catch (err) {
    console.error("Could not save to history", err);
  }
}

function renderHistory() {
  try {
    const history = JSON.parse(localStorage.getItem('getnow_history') || '[]');
    if (history.length === 0) {
      historySection.classList.add('hidden');
      return;
    }

    historySection.classList.remove('hidden');
    historyGrid.innerHTML = '';

    history.forEach(item => {
      const card = document.createElement('div');
      card.className = 'history-item';
      card.innerHTML = `
        <img class="history-thumb" src="${item.thumb}" alt="thumbnail" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'100\\' height=\\'100\\' fill=\\'%23222\\'><rect width=\\'100\\' height=\\'100\\'/></svg>'" />
        <div class="history-label">${item.type === 'video' ? '🎥 Video' : '🖼️ Image'} • ${item.quality}</div>
      `;
      card.addEventListener('click', () => {
        currentMedia = item;
        selectedResolutionUrl = item.url;
        displayResult(item);
      });
      historyGrid.appendChild(card);
    });
  } catch (err) {
    console.error("Could not render history", err);
  }
}

/* ============================================================
   Helpers
   ============================================================ */
function isValidUrl(string) {
  try {
    const url = new URL(string.startsWith('http') ? string : 'https://' + string);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_) {
    return false;
  }
}

function showStatus(htmlContent, type = "info") {
  statusMessage.innerHTML = htmlContent;
  statusMessage.className = `status-box ${type}`;
  statusMessage.classList.remove('hidden');
}

function hideStatus() {
  statusMessage.classList.add('hidden');
  statusMessage.innerHTML = '';
}

function setLoading(isLoading) {
  const spinner = fetchBtn.querySelector('.btn-spinner');
  const label = fetchBtn.querySelector('.btn-label');

  if (isLoading) {
    spinner.classList.remove('hidden');
    label.classList.add('hidden');
    fetchBtn.disabled = true;
  } else {
    spinner.classList.add('hidden');
    label.classList.remove('hidden');
    fetchBtn.disabled = false;
  }
}
