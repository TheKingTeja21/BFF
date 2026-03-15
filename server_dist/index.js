// server/index.ts
import express from "express";

// server/routes.ts
import { createServer } from "node:http";

// server/storage.ts
import * as fs from "fs";
import * as path from "path";
var STORAGE_PATH = path.join(process.cwd(), "server_storage.json");
var InMemoryStorage = class {
  alerts = [];
  knownFaces = [];
  streams = /* @__PURE__ */ new Map();
  snapshots = /* @__PURE__ */ new Map();
  profile = {
    displayName: "Admin",
    role: "Security Officer",
    avatar: "",
    updatedAt: Date.now()
  };
  constructor() {
    this.load();
    if (this.streams.size === 0) {
      this.streams.set("cam-01", {
        cameraId: "cam-01",
        cameraName: "Front Door",
        url: "",
        online: false,
        lastSeen: 0
      });
    }
  }
  save() {
    try {
      const data = {
        alerts: this.alerts,
        knownFaces: this.knownFaces,
        streams: Array.from(this.streams.entries()),
        profile: this.profile
      };
      fs.writeFileSync(STORAGE_PATH, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error("Failed to save storage:", e);
    }
  }
  load() {
    try {
      if (fs.existsSync(STORAGE_PATH)) {
        const raw = fs.readFileSync(STORAGE_PATH, "utf-8");
        const data = JSON.parse(raw);
        this.alerts = data.alerts || [];
        this.knownFaces = data.knownFaces || [];
        if (data.streams) {
          this.streams = new Map(data.streams);
        }
        this.profile = data.profile || this.profile;
      }
    } catch (e) {
      console.error("Failed to load storage:", e);
    }
  }
  getAlerts() {
    return this.alerts.sort((a, b) => b.timestamp - a.timestamp);
  }
  addAlert(alert) {
    const newAlert = {
      ...alert,
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      read: false
    };
    this.alerts.unshift(newAlert);
    if (this.alerts.length > 200) {
      this.alerts = this.alerts.slice(0, 200);
    }
    this.save();
    return newAlert;
  }
  markAlertRead(id) {
    const alert = this.alerts.find((a) => a.id === id);
    if (alert) {
      alert.read = true;
      this.save();
      return true;
    }
    return false;
  }
  markAllAlertsRead() {
    this.alerts.forEach((a) => a.read = true);
    this.save();
  }
  deleteAlert(id) {
    const idx = this.alerts.findIndex((a) => a.id === id);
    if (idx !== -1) {
      this.alerts.splice(idx, 1);
      this.save();
      return true;
    }
    return false;
  }
  clearAllAlerts() {
    this.alerts = [];
    this.save();
  }
  getKnownFaces() {
    return this.knownFaces;
  }
  addKnownFace(face) {
    const newFace = {
      ...face,
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      addedAt: Date.now()
    };
    this.knownFaces.push(newFace);
    this.save();
    return newFace;
  }
  updateKnownFace(id, updates) {
    const face = this.knownFaces.find((f) => f.id === id);
    if (face) {
      Object.assign(face, updates);
      this.save();
      return face;
    }
    return null;
  }
  deleteKnownFace(id) {
    const idx = this.knownFaces.findIndex((f) => f.id === id);
    if (idx !== -1) {
      this.knownFaces.splice(idx, 1);
      this.save();
      return true;
    }
    return false;
  }
  getStreams() {
    return Array.from(this.streams.values());
  }
  getStream(cameraId) {
    return this.streams.get(cameraId) || null;
  }
  upsertStream(config) {
    this.streams.set(config.cameraId, config);
    this.save();
  }
  getSnapshot(cameraId) {
    return this.snapshots.get(cameraId) || null;
  }
  updateSnapshot(snapshot) {
    this.snapshots.set(snapshot.cameraId, snapshot);
  }
  getUnreadCount() {
    return this.alerts.filter((a) => !a.read).length;
  }
  getProfile() {
    return this.profile;
  }
  updateProfile(updates) {
    Object.assign(this.profile, updates, { updatedAt: Date.now() });
    this.save();
    return this.profile;
  }
};
var storage = new InMemoryStorage();

// server/routes.ts
async function registerRoutes(app2) {
  app2.get("/api/alerts", (req, res) => {
    res.json(storage.getAlerts());
  });
  app2.post("/api/alerts", (req, res) => {
    const { snapshot, cameraId, cameraName, confidence, type, llm_analysis } = req.body;
    if (!snapshot || !cameraId) {
      return res.status(400).json({ message: "snapshot and cameraId required" });
    }
    const alert = storage.addAlert({
      snapshot,
      cameraId,
      cameraName: cameraName || cameraId,
      confidence: confidence || 0,
      timestamp: Date.now(),
      type: type || "unknown_face",
      llm_analysis
    });
    storage.upsertStream({
      cameraId,
      cameraName: cameraName || cameraId,
      url: storage.getStream(cameraId)?.url || "",
      online: true,
      lastSeen: Date.now()
    });
    res.status(201).json(alert);
  });
  app2.patch("/api/alerts/:id/read", (req, res) => {
    const ok = storage.markAlertRead(req.params.id);
    if (!ok) return res.status(404).json({ message: "Alert not found" });
    res.json({ success: true });
  });
  app2.post("/api/alerts/read-all", (req, res) => {
    storage.markAllAlertsRead();
    res.json({ success: true });
  });
  app2.delete("/api/alerts/:id", (req, res) => {
    const ok = storage.deleteAlert(req.params.id);
    if (!ok) return res.status(404).json({ message: "Alert not found" });
    res.json({ success: true });
  });
  app2.delete("/api/alerts", (req, res) => {
    storage.clearAllAlerts();
    res.json({ success: true });
  });
  app2.get("/api/alerts/unread-count", (req, res) => {
    res.json({ count: storage.getUnreadCount() });
  });
  app2.get("/api/known-faces", (req, res) => {
    res.json(storage.getKnownFaces());
  });
  app2.post("/api/known-faces", (req, res) => {
    const { name, role, photo, authorized } = req.body;
    if (!name || !photo) {
      return res.status(400).json({ message: "name and photo required" });
    }
    const face = storage.addKnownFace({
      name,
      role: role || "Resident",
      photo,
      authorized: authorized !== false
    });
    res.status(201).json(face);
  });
  app2.patch("/api/known-faces/:id", (req, res) => {
    const face = storage.updateKnownFace(req.params.id, req.body);
    if (!face) return res.status(404).json({ message: "Face not found" });
    res.json(face);
  });
  app2.delete("/api/known-faces/:id", (req, res) => {
    const ok = storage.deleteKnownFace(req.params.id);
    if (!ok) return res.status(404).json({ message: "Face not found" });
    res.json({ success: true });
  });
  app2.get("/api/streams", (req, res) => {
    res.json(storage.getStreams());
  });
  app2.post("/api/streams", (req, res) => {
    const { cameraId, cameraName, url } = req.body;
    if (!cameraId) {
      return res.status(400).json({ message: "cameraId required" });
    }
    storage.upsertStream({
      cameraId,
      cameraName: cameraName || cameraId,
      url: url || "",
      online: true,
      lastSeen: Date.now()
    });
    res.json(storage.getStream(cameraId));
  });
  app2.put("/api/streams/:cameraId", (req, res) => {
    const { cameraName, url } = req.body;
    const existing = storage.getStream(req.params.cameraId);
    storage.upsertStream({
      cameraId: req.params.cameraId,
      cameraName: cameraName || existing?.cameraName || req.params.cameraId,
      url: url !== void 0 ? url : existing?.url || "",
      online: existing?.online || false,
      lastSeen: existing?.lastSeen || Date.now()
    });
    res.json(storage.getStream(req.params.cameraId));
  });
  app2.get("/api/snapshot/:cameraId", (req, res) => {
    const snapshot = storage.getSnapshot(req.params.cameraId);
    if (!snapshot) return res.status(404).json({ message: "No snapshot" });
    res.json(snapshot);
  });
  app2.post("/api/snapshot", (req, res) => {
    const { cameraId, image, cameraName } = req.body;
    if (!cameraId || !image) {
      return res.status(400).json({ message: "cameraId and image required" });
    }
    storage.updateSnapshot({ cameraId, image, timestamp: Date.now() });
    storage.upsertStream({
      cameraId,
      cameraName: cameraName || cameraId,
      url: storage.getStream(cameraId)?.url || "",
      online: true,
      lastSeen: Date.now()
    });
    res.json({ success: true });
  });
  app2.get("/api/status", (req, res) => {
    res.json({
      cameras: storage.getStreams(),
      unreadAlerts: storage.getUnreadCount(),
      knownFaces: storage.getKnownFaces().length
    });
  });
  app2.get("/api/profile", (req, res) => {
    res.json(storage.getProfile());
  });
  app2.put("/api/profile", (req, res) => {
    const { displayName, role, avatar } = req.body;
    const updated = storage.updateProfile({ displayName, role, avatar });
    res.json(updated);
  });
  const httpServer = createServer(app2);
  return httpServer;
}

// server/index.ts
import * as fs2 from "fs";
import * as path2 from "path";

// server/templates/landing-page.html
var landing_page_default = `<!doctype html>
<html>
  <head>
    <title>APP_NAME_PLACEHOLDER</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      * {
        box-sizing: border-box;
      }
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        margin: 0;
        padding: 32px 20px;
        text-align: center;
        background: #fff;
        color: #222;
        line-height: 1.5;
        min-height: 100vh;
      }
      .wrapper {
        max-width: 480px;
        margin: 0 auto;
      }
      h1 {
        font-size: 26px;
        font-weight: 600;
        margin: 0;
        color: #111;
      }
      .subtitle {
        font-size: 15px;
        color: #666;
        margin-top: 8px;
        margin-bottom: 32px;
      }
      .loading {
        display: none;
        margin: 60px 0;
      }
      .spinner {
        border: 2px solid #ddd;
        border-top-color: #333;
        border-radius: 50%;
        width: 32px;
        height: 32px;
        animation: spin 0.8s linear infinite;
        margin: 20px auto;
      }
      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }
      .loading-text {
        font-size: 16px;
        color: #444;
      }
      .content {
        display: block;
      }

      .steps-container {
        display: flex;
        flex-direction: column;
        gap: 20px;
      }

      .step {
        padding: 24px;
        border: 1px solid #ddd;
        border-radius: 12px;
        text-align: center;
        background: #fafafa;
      }
      .step-header {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        margin-bottom: 12px;
      }
      .step-number {
        width: 28px;
        height: 28px;
        border: 1px solid #999;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 600;
        font-size: 14px;
        flex-shrink: 0;
        color: #555;
      }
      .step-title {
        font-size: 18px;
        font-weight: 600;
        margin: 0;
        color: #222;
      }
      .step-description {
        font-size: 14px;
        margin-bottom: 16px;
        color: #666;
      }

      .store-buttons {
        display: flex;
        flex-direction: column;
        gap: 6px;
        justify-content: center;
        flex-wrap: wrap;
      }
      .store-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 12px 20px;
        font-size: 14px;
        font-weight: 500;
        border: 1px solid #ccc;
        border-radius: 8px;
        text-decoration: none;
        color: #333;
        background: #fff;
        transition: all 0.15s;
      }
      .store-button:hover {
        background: #f5f5f5;
        border-color: #999;
      }
      .store-link {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 8px 0;
        font-size: 13px;
        font-weight: 400;
        text-decoration: underline;
        text-underline-offset: 2px;
        color: #666;
        background: none;
        border: none;
        transition: color 0.15s;
      }
      .store-link:hover {
        color: #333;
      }
      .store-link .store-icon {
        width: 14px;
        height: 14px;
      }
      .store-icon {
        width: 18px;
        height: 18px;
      }

      .qr-section {
        background: #333;
        color: #fff;
        border-color: #333;
      }
      .qr-section .step-number {
        border-color: rgba(255, 255, 255, 0.5);
        color: #fff;
      }
      .qr-section .step-title {
        color: #fff;
      }
      .qr-section .step-description {
        color: rgba(255, 255, 255, 0.7);
      }
      .qr-code {
        width: 180px;
        height: 180px;
        margin: 0 auto 16px;
        background: #fff;
        border-radius: 8px;
        padding: 12px;
      }
      .qr-code canvas {
        width: 100%;
        height: 100%;
      }
      .open-button {
        display: inline-block;
        padding: 12px 24px;
        font-size: 14px;
        font-weight: 500;
        border: 1px solid rgba(255, 255, 255, 0.3);
        border-radius: 8px;
        text-decoration: none;
        color: #333;
        background: #fff;
        transition: opacity 0.15s;
      }
      .open-button:hover {
        opacity: 0.9;
      }

      /* Desktop styles */
      @media (min-width: 768px) {
        body {
          padding: 48px 32px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .wrapper {
          max-width: 720px;
        }
        h1 {
          font-size: 32px;
          margin-bottom: 10px;
        }
        .subtitle {
          font-size: 16px;
          margin-bottom: 40px;
        }
        .steps-container {
          flex-direction: row;
          gap: 20px;
          align-items: stretch;
        }
        .step {
          flex: 1;
          display: flex;
          flex-direction: column;
          padding: 28px;
        }
        .step-description {
          flex-grow: 1;
        }
        .store-buttons {
          flex-direction: column;
          gap: 10px;
        }
        .qr-code {
          width: 200px;
          height: 200px;
        }
      }

      /* Large desktop */
      @media (min-width: 1024px) {
        .wrapper {
          max-width: 800px;
        }
        h1 {
          font-size: 36px;
        }
        .steps-container {
          gap: 28px;
        }
        .step {
          padding: 32px;
        }
      }

      /* Dark mode */
      @media (prefers-color-scheme: dark) {
        body {
          background: #0d0d0d;
          color: #e0e0e0;
        }
        h1 {
          color: #f5f5f5;
        }
        .subtitle {
          color: #999;
        }
        .spinner {
          border-color: #444;
          border-top-color: #ccc;
        }
        .loading-text {
          color: #aaa;
        }
        .step {
          border-color: #333;
          background: #1a1a1a;
        }
        .step-number {
          border-color: #666;
          color: #bbb;
        }
        .step-title {
          color: #f0f0f0;
        }
        .step-description {
          color: #888;
        }
        .store-button {
          border-color: #444;
          color: #e0e0e0;
          background: #222;
        }
        .store-button:hover {
          background: #2a2a2a;
          border-color: #666;
        }
        .store-link {
          color: #888;
        }
        .store-link:hover {
          color: #ccc;
        }
        .qr-section {
          background: #111;
          border-color: #333;
        }
        .qr-section .step-number {
          border-color: rgba(255, 255, 255, 0.4);
        }
        .qr-section .step-description {
          color: rgba(255, 255, 255, 0.6);
        }
        .open-button {
          background: #f0f0f0;
          color: #111;
        }
        .open-button:hover {
          background: #e0e0e0;
        }
      }
    </style>
  </head>
  <body>
    <div class="wrapper">
      <div class="loading" id="loading">
        <div class="spinner"></div>
        <div class="loading-text">Opening in Expo Go...</div>
      </div>

      <div class="content" id="content">
        <h1>APP_NAME_PLACEHOLDER</h1>
        <p class="subtitle">Preview this app on your phone</p>

        <div class="steps-container">
          <div class="step">
            <div class="step-header">
              <div class="step-number">1</div>
              <h2 class="step-title">Download Expo Go</h2>
            </div>
            <p class="step-description">
              Expo Go is a free app to test mobile apps
            </p>
            <div class="store-buttons" id="store-buttons">
              <a
                id="app-store-btn"
                href="https://apps.apple.com/app/id982107779"
                class="store-button"
                target="_blank"
              >
                <svg class="store-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path
                    d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"
                  />
                </svg>
                App Store
              </a>
              <a
                id="play-store-btn"
                href="https://play.google.com/store/apps/details?id=host.exp.exponent"
                class="store-button"
                target="_blank"
              >
                <svg class="store-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path
                    d="M3,20.5V3.5C3,2.91 3.34,2.39 3.84,2.15L13.69,12L3.84,21.85C3.34,21.6 3,21.09 3,20.5M16.81,15.12L6.05,21.34L14.54,12.85L16.81,15.12M20.16,10.81C20.5,11.08 20.75,11.5 20.75,12C20.75,12.5 20.53,12.9 20.18,13.18L17.89,14.5L15.39,12L17.89,9.5L20.16,10.81M6.05,2.66L16.81,8.88L14.54,11.15L6.05,2.66Z"
                  />
                </svg>
                Google Play
              </a>
            </div>
          </div>

          <div class="step qr-section">
            <div class="step-header">
              <div class="step-number">2</div>
              <h2 class="step-title">Scan QR Code</h2>
            </div>
            <p class="step-description">Use your phone's camera or Expo Go</p>
            <div class="qr-code" id="qr-code"></div>
            <a href="exps://EXPS_URL_PLACEHOLDER" class="open-button"
              >Open in Expo Go</a
            >
          </div>
        </div>
      </div>
    </div>

    <script src="https://unpkg.com/qr-code-styling@1.6.0/lib/qr-code-styling.js"></script>
    <script>
      (function () {
        const ua = navigator.userAgent;
        const loadingEl = document.getElementById("loading");
        const contentEl = document.getElementById("content");

        const isAndroid = /Android/i.test(ua);
        const isIOS =
          /iPhone|iPad|iPod/i.test(ua) ||
          (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

        const deepLink = "exps://EXPS_URL_PLACEHOLDER";

        // Adjust store buttons based on platform
        const appStoreBtn = document.getElementById("app-store-btn");
        const playStoreBtn = document.getElementById("play-store-btn");
        const storeButtonsContainer = document.getElementById("store-buttons");

        if (isIOS) {
          playStoreBtn.className = "store-link";
          storeButtonsContainer.appendChild(playStoreBtn);
        } else if (isAndroid) {
          appStoreBtn.className = "store-link";
          storeButtonsContainer.insertBefore(playStoreBtn, appStoreBtn);
        }

        const qrCode = new QRCodeStyling({
          width: 400,
          height: 400,
          data: deepLink,
          dotsOptions: {
            color: "#333333",
            type: "rounded",
          },
          backgroundOptions: {
            color: "#ffffff",
          },
          cornersSquareOptions: {
            type: "extra-rounded",
          },
          cornersDotOptions: {
            type: "dot",
          },
          qrOptions: {
            errorCorrectionLevel: "H",
          },
        });

        qrCode.append(document.getElementById("qr-code"));

        if (isAndroid || isIOS) {
          loadingEl.style.display = "block";
          contentEl.style.display = "none";
          window.location.href = deepLink;
          setTimeout(function () {
            loadingEl.style.display = "none";
            contentEl.style.display = "block";
          }, 500);
        }
      })();
    </script>
  </body>
</html>
`;

// server/index.ts
var app = express();
var log = console.log;
function setupCors(app2) {
  app2.use((req, res, next) => {
    const origins = /* @__PURE__ */ new Set();
    if (process.env.REPLIT_DEV_DOMAIN) {
      origins.add(`https://${process.env.REPLIT_DEV_DOMAIN}`);
    }
    if (process.env.REPLIT_DOMAINS) {
      process.env.REPLIT_DOMAINS.split(",").forEach((d) => {
        origins.add(`https://${d.trim()}`);
      });
    }
    const origin = req.header("origin");
    const isLocalhost = origin?.startsWith("http://localhost:") || origin?.startsWith("http://127.0.0.1:");
    if (origin && (origins.has(origin) || isLocalhost)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS"
      );
      res.header("Access-Control-Allow-Headers", "Content-Type");
      res.header("Access-Control-Allow-Credentials", "true");
    }
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });
}
function setupBodyParsing(app2) {
  app2.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      }
    })
  );
  app2.use(express.urlencoded({ extended: false }));
}
function setupRequestLogging(app2) {
  app2.use((req, res, next) => {
    const start = Date.now();
    const path3 = req.path;
    let capturedJsonResponse = void 0;
    const originalResJson = res.json;
    res.json = function(bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };
    res.on("finish", () => {
      if (!path3.startsWith("/api")) return;
      const duration = Date.now() - start;
      let logLine = `${req.method} ${path3} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "\u2026";
      }
      log(logLine);
    });
    next();
  });
}
function getAppName() {
  try {
    const appJsonPath = path2.resolve(process.cwd(), "app.json");
    const appJsonContent = fs2.readFileSync(appJsonPath, "utf-8");
    const appJson = JSON.parse(appJsonContent);
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}
function serveExpoManifest(platform, res) {
  const manifestPath = path2.resolve(
    process.cwd(),
    "static-build",
    platform,
    "manifest.json"
  );
  if (!fs2.existsSync(manifestPath)) {
    return res.status(404).json({ error: `Manifest not found for platform: ${platform}` });
  }
  res.setHeader("expo-protocol-version", "1");
  res.setHeader("expo-sfv-version", "0");
  res.setHeader("content-type", "application/json");
  const manifest = fs2.readFileSync(manifestPath, "utf-8");
  res.send(manifest);
}
function serveLandingPage({
  req,
  res,
  landingPageTemplate,
  appName
}) {
  const forwardedProto = req.header("x-forwarded-proto");
  const protocol = forwardedProto || req.protocol || "https";
  const forwardedHost = req.header("x-forwarded-host");
  const host = forwardedHost || req.get("host");
  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `${host}`;
  log(`baseUrl`, baseUrl);
  log(`expsUrl`, expsUrl);
  const html = landingPageTemplate.replace(/BASE_URL_PLACEHOLDER/g, baseUrl).replace(/EXPS_URL_PLACEHOLDER/g, expsUrl).replace(/APP_NAME_PLACEHOLDER/g, appName);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
}
function configureExpoAndLanding(app2) {
  const appName = getAppName();
  log("Serving static Expo files with dynamic manifest routing");
  app2.use((req, res, next) => {
    if (req.path.startsWith("/api")) {
      return next();
    }
    if (req.path !== "/" && req.path !== "/manifest") {
      return next();
    }
    const platform = req.header("expo-platform");
    if (platform && (platform === "ios" || platform === "android")) {
      return serveExpoManifest(platform, res);
    }
    if (req.path === "/") {
      return serveLandingPage({
        req,
        res,
        landingPageTemplate: landing_page_default,
        appName
      });
    }
    next();
  });
  app2.use("/assets", express.static(path2.resolve(process.cwd(), "assets")));
  app2.use(express.static(path2.resolve(process.cwd(), "static-build")));
  log("Expo routing: Checking expo-platform header on / and /manifest");
}
function setupErrorHandler(app2) {
  app2.use((err, _req, res, next) => {
    const error = err;
    const status = error.status || error.statusCode || 500;
    const message = error.message || "Internal Server Error";
    console.error("Internal Server Error:", err);
    if (res.headersSent) {
      return next(err);
    }
    return res.status(status).json({ message });
  });
}
(async () => {
  setupCors(app);
  setupBodyParsing(app);
  setupRequestLogging(app);
  configureExpoAndLanding(app);
  const server = await registerRoutes(app);
  setupErrorHandler(app);
  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen(
    {
      port,
      host: "0.0.0.0"
    },
    () => {
      log(`express server serving on port ${port}`);
    }
  );
})();
