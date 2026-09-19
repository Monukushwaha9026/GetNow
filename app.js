/**
 * GetNow - Pinterest Video & Image Downloader
 * Pure Frontend Client-Side Application
 */

// DOM Elements
const pinUrlInput = document.getElementById('pinUrlInput');
const pasteBtn = document.getElementById('pasteBtn');
const clearBtn = document.getElementById('clearBtn');
const fetchBtn = document.getElementById('fetchBtn');
const sampleBtn = document.getElementById('sampleBtn');
const statusMessage = document.getElementById('statusMessage');

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

// History Elements
const historySection = document.getElementById('historySection');
const historyGrid = document.getElementById('historyGrid');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');

// Current Media State
let currentMedia = null;

// Sample Pin for Testing
const SAMPLE_PIN = "https://i.pinimg.com/736x/8f/23/e4/8f23e44fa70c868c1ae3b5cb4e840a1b.jpg";

/* ============================================================
   Event Listeners
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  renderHistory();
});

// Input changes
pinUrlInput.addEventListener('input', () => {
  if (pinUrlInput.value.trim().length > 0) {
    clearBtn.classList.remove('hidden');
  } else {
    clearBtn.classList.add('hidden');
  }
});

// Enter key to fetch
pinUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    handleFetch();
  }
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
    showStatus("Clipboard access denied. Please paste manually using Ctrl+V.", "error");
  }
});

// Sample Pin
sampleBtn.addEventListener('click', () => {
  pinUrlInput.value = SAMPLE_PIN;
  clearBtn.classList.remove('hidden');
  handleFetch();
});

// Fetch Button
fetchBtn.addEventListener('click', handleFetch);

// Download Button
downloadBtn.addEventListener('click', () => {
  if (!currentMedia || !currentMedia.url) return;
  triggerDownload(currentMedia.url, currentMedia.filename);
});

// Copy Direct Link
copyLinkBtn.addEventListener('click', async () => {
  if (!currentMedia || !currentMedia.url) return;
  try {
    await navigator.clipboard.writeText(currentMedia.url);
    const originalSvg = copyLinkBtn.innerHTML;
    copyLinkBtn.innerHTML = `✓`;
    copyLinkBtn.style.color = "var(--success)";
    setTimeout(() => {
      copyLinkBtn.innerHTML = originalSvg;
      copyLinkBtn.style.color = "";
    }, 2000);
  } catch (err) {
    showStatus("Unable to copy link to clipboard.", "error");
  }
});

// Clear History
clearHistoryBtn.addEventListener('click', () => {
  localStorage.removeItem('getnow_history');
  renderHistory();
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

  // Validate URL format
  if (!isValidUrl(rawUrl)) {
    showStatus("Please enter a valid Pinterest URL (e.g. https://pin.it/... or pinterest.com/pin/...)", "error");
    return;
  }

  setLoading(true);
  resultCard.classList.add('hidden');

  try {
    const media = await extractPinterestMedia(rawUrl);
    if (media && media.url) {
      currentMedia = media;
      displayResult(media);
      saveToHistory(media);
    } else {
      throw new Error("Could not find downloadable media from this link.");
    }
  } catch (err) {
    console.error("Extraction error:", err);
    showStatus(
      `⚠️ Could not extract media automatically.<br/>
       <strong>💡 Easy Fix:</strong> On Pinterest, right-click (or hold) the image/video → 
       select <em>"Copy Image Address"</em> or <em>"Copy Video Address"</em> → paste it here!`,
      "error"
    );
  } finally {
    setLoading(false);
  }
}

/**
 * Extracts Pinterest media using direct parsing or CORS proxies
 */
async function extractPinterestMedia(url) {
  // Strategy 1: Direct pinimg.com Image URL
  if (url.includes("pinimg.com")) {
    // Replace any thumbnail sizes with originals for maximum HD resolution
    const originalUrl = url.replace(/\/(?:\d+x|originals)\//, "/originals/");
    return {
      type: "image",
      url: originalUrl,
      thumb: originalUrl,
      quality: "Original HD / 4K",
      filename: `GetNow_Pinterest_Image_${Date.now()}.jpg`
    };
  }

  // Strategy 2: Direct pin.it or pinterest.com Pin Page Scraping via Proxies
  const proxies = [
    // AllOrigins JSON proxy
    async (target) => {
      const res = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(target)}`);
      if (!res.ok) throw new Error("AllOrigins failed");
      const data = await res.json();
      return data.contents;
    },
    // CodeTabs proxy
    async (target) => {
      const res = await fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(target)}`);
      if (!res.ok) throw new Error("CodeTabs failed");
      return await res.text();
    }
  ];

  let html = null;
  let lastError = null;

  for (const proxy of proxies) {
    try {
      html = await proxy(url);
      if (html && html.length > 500) {
        break; // Successfully obtained HTML
      }
    } catch (e) {
      lastError = e;
    }
  }

  if (!html) {
    throw lastError || new Error("Failed to fetch Pinterest page via proxy");
  }

  // Parse HTML for video or image
  return parsePinterestHtml(html);
}

/**
 * Parses raw HTML string to find Pinterest video or image
 */
function parsePinterestHtml(html) {
  // 1. Look for Video sources
  // Check for og:video meta tags
  const ogVideoMatch = html.match(/<meta\s+property=["']og:video(?::secure_url)?["']\s+content=["']([^"']+)["']/i) ||
                       html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:video(?::secure_url)?["']/i);
  
  if (ogVideoMatch && ogVideoMatch[1]) {
    const videoUrl = cleanUrl(ogVideoMatch[1]);
    const thumb = getOgImage(html) || "";
    return {
      type: "video",
      url: videoUrl,
      thumb: thumb,
      quality: "HD Video (MP4)",
      filename: `GetNow_Pinterest_Video_${Date.now()}.mp4`
    };
  }

  // Check for direct MP4 video URL in script tags or source
  const directVideoMatch = html.match(/https:\/\/(?:v|v1)\.pinimg\.com\/videos\/[^\s"'<>]+\.mp4/i);
  if (directVideoMatch && directVideoMatch[0]) {
    const videoUrl = cleanUrl(directVideoMatch[0]);
    const thumb = getOgImage(html) || "";
    return {
      type: "video",
      url: videoUrl,
      thumb: thumb,
      quality: "HD Video (MP4)",
      filename: `GetNow_Pinterest_Video_${Date.now()}.mp4`
    };
  }

  // Check for __PWS_DATA__ JSON script
  const pwsMatch = html.match(/<script\s+id=["']__PWS_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (pwsMatch && pwsMatch[1]) {
    try {
      const data = JSON.parse(pwsMatch[1]);
      const pins = data?.props?.initialReduxState?.pins || {};
      const pinKey = Object.keys(pins)[0];
      if (pinKey && pins[pinKey]) {
        const pin = pins[pinKey];

        // Check for video list in pin data
        if (pin.videos && pin.videos.video_list) {
          const vList = pin.videos.video_list;
          const bestVideo = vList.V_720P || vList.V_EXP7 || vList.V_HLSV4 || Object.values(vList)[0];
          if (bestVideo && bestVideo.url) {
            let vidUrl = bestVideo.url;
            if (vidUrl.includes('.m3u8')) {
              // Convert HLS m3u8 to mp4 if standard format
              vidUrl = vidUrl.replace('/hls/', '/mc/').replace('.m3u8', '.mp4');
            }
            return {
              type: "video",
              url: vidUrl,
              thumb: pin.images?.orig?.url || "",
              quality: "HD Video (MP4)",
              filename: `GetNow_Pinterest_Video_${Date.now()}.mp4`
            };
          }
        }

        // Check for original image in pin data
        if (pin.images && pin.images.orig && pin.images.orig.url) {
          return {
            type: "image",
            url: pin.images.orig.url,
            thumb: pin.images.orig.url,
            quality: "Original HD / 4K",
            filename: `GetNow_Pinterest_Image_${Date.now()}.jpg`
          };
        }
      }
    } catch (jsonErr) {
      console.warn("Could not parse __PWS_DATA__", jsonErr);
    }
  }

  // 2. Look for Image sources
  const ogImage = getOgImage(html);
  if (ogImage) {
    const originalImage = ogImage.replace(/\/(?:\d+x|originals)\//, "/originals/");
    return {
      type: "image",
      url: originalImage,
      thumb: originalImage,
      quality: "Original HD / 4K",
      filename: `GetNow_Pinterest_Image_${Date.now()}.jpg`
    };
  }

  // Regex match for any i.pinimg.com image URL
  const imgRegexMatch = html.match(/https:\/\/i\.pinimg\.com\/(?:originals|\d+x)\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp)/i);
  if (imgRegexMatch && imgRegexMatch[0]) {
    const originalImage = imgRegexMatch[0].replace(/\/(?:\d+x|originals)\//, "/originals/");
    return {
      type: "image",
      url: originalImage,
      thumb: originalImage,
      quality: "Original HD / 4K",
      filename: `GetNow_Pinterest_Image_${Date.now()}.jpg`
    };
  }

  throw new Error("No media stream or image found in the page.");
}

function getOgImage(html) {
  const match = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i) ||
                html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i);
  return match ? cleanUrl(match[1]) : null;
}

function cleanUrl(url) {
  return url.replace(/&amp;/g, '&').replace(/\\u0026/g, '&').trim();
}

/* ============================================================
   UI Rendering & Results
   ============================================================ */
function displayResult(media) {
  resultCard.classList.remove('hidden');

  mediaQualityTag.textContent = media.quality;

  if (media.type === 'video') {
    mediaTypeIcon.textContent = '🎥';
    mediaTypeText.textContent = 'Pinterest Video';
    downloadBtnText.textContent = 'Download HD Video (MP4)';

    imageWrapper.classList.add('hidden');
    videoWrapper.classList.remove('hidden');

    videoPreview.src = media.url;
    videoPreview.load();
  } else {
    mediaTypeIcon.textContent = '🖼️';
    mediaTypeText.textContent = 'Pinterest Image';
    downloadBtnText.textContent = 'Download Original Image (HD)';

    videoWrapper.classList.add('hidden');
    imageWrapper.classList.remove('hidden');

    imagePreview.src = media.url;
  }

  // Set Open In New Tab Link
  openTabBtn.href = media.url;

  // Scroll smoothly to results
  resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ============================================================
   File Download Handler
   ============================================================ */
async function triggerDownload(url, filename) {
  const originalText = downloadBtnText.textContent;
  downloadBtnText.textContent = "Starting Download...";

  try {
    // Attempt blob download for direct file save
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
    // If browser CORS prevents client-side blob reading, fallback to direct tab
    console.warn("Direct blob download failed, falling back to window.open", err);
    window.open(url, '_blank');
    downloadBtnText.textContent = "Opened in New Tab!";
    setTimeout(() => { downloadBtnText.textContent = originalText; }, 2500);
  }
}

/* ============================================================
   History Management
   ============================================================ */
function saveToHistory(media) {
  try {
    let history = JSON.parse(localStorage.getItem('getnow_history') || '[]');
    // Filter out duplicates
    history = history.filter(item => item.url !== media.url);
    history.unshift({
      type: media.type,
      url: media.url,
      thumb: media.thumb || media.url,
      filename: media.filename,
      quality: media.quality,
      date: new Date().toLocaleDateString()
    });

    // Keep only last 6 items
    if (history.length > 6) history = history.slice(0, 6);

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
        displayResult(item);
      });
      historyGrid.appendChild(card);
    });
  } catch (err) {
    console.error("Could not render history", err);
  }
}

/* ============================================================
   Helper Functions
   ============================================================ */
function isValidUrl(string) {
  try {
    const url = new URL(string);
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
