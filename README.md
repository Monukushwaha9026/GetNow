# GetNow ⚡ — Pinterest Video & Image Downloader (v2.0)

A lightning-fast, minimal, and modern web application to download Pinterest videos, images, and GIFs in original high quality (Full HD & 4K).

Works both as a **standalone client-side app on GitHub Pages** and with an optional **zero-dependency Node.js local server** for 100% reliable direct file saving.

---

## ✨ Features

- **⚡ Instant Media Extraction:** Paste any Pinterest pin link, shortlink (`pin.it`), or direct image URL to preview and download.
- **🎥 HD MP4 Videos:** Automatically detects and extracts high-definition MP4 streams and video lists.
- **🖼️ 4K Smart Image Upscaler:** Automatically upgrades low-res thumbnails (`/736x/`, `/564x/`, `/236x/`) to full uncompressed originals (`/originals/`).
- **🎯 Multi-Resolution Selector:** Choose between Original 4K, Large HD, or standard resolutions directly in the UI.
- **💾 Direct File Saving (Zero CORS issues):** When running locally with `npm start`, media streams directly with proper download headers straight to your Downloads folder.
- **🌐 100% Client-Side Compatible:** Fully runs on **GitHub Pages** without any backend required.
- **📋 Page Source Fallback:** Includes a 1-click Page Source extractor modal to bypass all CORS blocks or Pinterest rate-limits on static hosts.
- **📜 Recent History:** Saves your recent downloads locally in your browser's `localStorage`.
- **📱 Fully Responsive:** Clean dark mode UI crafted with modern CSS glassmorphism, responsive across desktop and mobile.

---

## 🚀 Quick Start (Local Development)

No complex installations or heavy frameworks required — runs on native Node.js (v18+ or v20+ / v24+):

```bash
# 1. Clone the repository
git clone https://github.com/Monukushwaha9026/GetNow.git
cd GetNow

# 2. Start the local server (zero npm dependencies required!)
npm start
# or: node server.js
```

Open your browser at:
👉 **`http://localhost:3030`**

---

## 🌐 Deploy to GitHub Pages (Static Hosting)

1. Fork or push this repository to GitHub.
2. Go to **Settings > Pages** in your GitHub repository.
3. Under **Build and deployment**:
   - **Source:** Select `Deploy from a branch`
   - **Branch:** Select `main` and folder `/(root)`
4. Click **Save**.
5. Your live app will be accessible at:
   👉 `https://<your-username>.github.io/GetNow/`

---

## 📁 Project Structure

```
GetNow/
├── index.html       # Clean semantic UI with media preview, quality pills, and modal
├── style.css        # Responsive dark-theme styling, glassmorphism, and micro-interactions
├── app.js           # Client-side extraction engine, backend auto-detector, and DOM logic
├── server.js        # Lightweight zero-dependency Node.js backend server with stream download API
├── package.json     # Project metadata and npm start script
└── README.md        # Documentation and usage guide
```

---

## 💻 Tech Stack

- **Frontend:** Vanilla HTML5, CSS3 (variables, flexbox/grid, glassmorphism), ES6+ JavaScript.
- **Backend:** Native Node.js `http` and `stream` modules (zero npm dependencies).
- **APIs:** Pinterest hydration parser (`__PWS_INITIAL_PROPS__`, `__PWS_DATA__`), OpenGraph/Twitter meta extraction, JSON-LD Schema.

---

## ⚖️ Disclaimer

GetNow is an independent open-source tool and is not affiliated with Pinterest. All media files and trademarks belong to their respective owners.
