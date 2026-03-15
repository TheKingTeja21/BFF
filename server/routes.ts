import type { Express } from "express";
import { createServer, type Server } from "node:http";
import { storage } from "./storage";

export async function registerRoutes(app: Express): Promise<Server> {
  app.get("/api/alerts", (req, res) => {
    res.json(storage.getAlerts());
  });

  app.post("/api/alerts", (req, res) => {
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
      llm_analysis,
    });
    storage.upsertStream({
      cameraId,
      cameraName: cameraName || cameraId,
      url: storage.getStream(cameraId)?.url || "",
      online: true,
      lastSeen: Date.now(),
    });
    res.status(201).json(alert);
  });

  app.patch("/api/alerts/:id/read", (req, res) => {
    const ok = storage.markAlertRead(req.params.id);
    if (!ok) return res.status(404).json({ message: "Alert not found" });
    res.json({ success: true });
  });

  app.post("/api/alerts/read-all", (req, res) => {
    storage.markAllAlertsRead();
    res.json({ success: true });
  });

  app.delete("/api/alerts/:id", (req, res) => {
    const ok = storage.deleteAlert(req.params.id);
    if (!ok) return res.status(404).json({ message: "Alert not found" });
    res.json({ success: true });
  });

  app.delete("/api/alerts", (req, res) => {
    storage.clearAllAlerts();
    res.json({ success: true });
  });

  app.get("/api/alerts/unread-count", (req, res) => {
    res.json({ count: storage.getUnreadCount() });
  });

  app.get("/api/known-faces", (req, res) => {
    res.json(storage.getKnownFaces());
  });

  app.post("/api/known-faces", (req, res) => {
    const { name, role, photo, authorized } = req.body;
    if (!name || !photo) {
      return res.status(400).json({ message: "name and photo required" });
    }
    const face = storage.addKnownFace({
      name,
      role: role || "Resident",
      photo,
      authorized: authorized !== false,
    });
    res.status(201).json(face);
  });

  app.patch("/api/known-faces/:id", (req, res) => {
    const face = storage.updateKnownFace(req.params.id, req.body);
    if (!face) return res.status(404).json({ message: "Face not found" });
    res.json(face);
  });

  app.delete("/api/known-faces/:id", (req, res) => {
    const ok = storage.deleteKnownFace(req.params.id);
    if (!ok) return res.status(404).json({ message: "Face not found" });
    res.json({ success: true });
  });

  app.get("/api/streams", (req, res) => {
    res.json(storage.getStreams());
  });

  app.post("/api/streams", (req, res) => {
    const { cameraId, cameraName, url } = req.body;
    if (!cameraId) {
      return res.status(400).json({ message: "cameraId required" });
    }
    storage.upsertStream({
      cameraId,
      cameraName: cameraName || cameraId,
      url: url || "",
      online: true,
      lastSeen: Date.now(),
    });
    res.json(storage.getStream(cameraId));
  });

  app.put("/api/streams/:cameraId", (req, res) => {
    const { cameraName, url } = req.body;
    const existing = storage.getStream(req.params.cameraId);
    storage.upsertStream({
      cameraId: req.params.cameraId,
      cameraName: cameraName || existing?.cameraName || req.params.cameraId,
      url: url !== undefined ? url : existing?.url || "",
      online: existing?.online || false,
      lastSeen: existing?.lastSeen || Date.now(),
    });
    res.json(storage.getStream(req.params.cameraId));
  });

  app.get("/api/snapshot/:cameraId", (req, res) => {
    const snapshot = storage.getSnapshot(req.params.cameraId);
    if (!snapshot) return res.status(404).json({ message: "No snapshot" });
    res.json(snapshot);
  });

  app.post("/api/snapshot", (req, res) => {
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
      lastSeen: Date.now(),
    });
    res.json({ success: true });
  });

  app.get("/api/status", (req, res) => {
    res.json({
      cameras: storage.getStreams(),
      unreadAlerts: storage.getUnreadCount(),
      knownFaces: storage.getKnownFaces().length,
    });
  });

  app.get("/api/profile", (req, res) => {
    res.json(storage.getProfile());
  });

  app.put("/api/profile", (req, res) => {
    const { displayName, role, avatar } = req.body;
    const updated = storage.updateProfile({ displayName, role, avatar });
    res.json(updated);
  });

  const httpServer = createServer(app);
  return httpServer;
}
