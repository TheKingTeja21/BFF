import * as fs from "fs";
import * as path from "path";

export interface Alert {
  id: string;
  timestamp: number;
  snapshot: string;
  cameraId: string;
  cameraName: string;
  confidence: number;
  read: boolean;
  type: "unknown_face" | "multiple_unknown" | "no_match";
  llm_analysis?: string;
}

export interface KnownFace {
  id: string;
  name: string;
  role: string;
  photo: string;
  addedAt: number;
  authorized: boolean;
}

export interface StreamConfig {
  url: string;
  cameraId: string;
  cameraName: string;
  online: boolean;
  lastSeen: number;
}

export interface Snapshot {
  cameraId: string;
  image: string;
  timestamp: number;
}

export interface UserProfile {
  displayName: string;
  role: string;
  avatar: string;
  updatedAt: number;
}

const STORAGE_PATH = path.join(process.cwd(), "server_storage.json");

class InMemoryStorage {
  private alerts: Alert[] = [];
  private knownFaces: KnownFace[] = [];
  private streams: Map<string, StreamConfig> = new Map();
  private snapshots: Map<string, Snapshot> = new Map();
  private profile: UserProfile = {
    displayName: "Admin",
    role: "Security Officer",
    avatar: "",
    updatedAt: Date.now(),
  };

  constructor() {
    this.load();
    // Default camera if none exists
    if (this.streams.size === 0) {
      this.streams.set("cam-01", {
        cameraId: "cam-01",
        cameraName: "Front Door",
        url: "",
        online: false,
        lastSeen: 0,
      });
    }
  }

  private save() {
    try {
      const data = {
        alerts: this.alerts,
        knownFaces: this.knownFaces,
        streams: Array.from(this.streams.entries()),
        profile: this.profile,
      };
      fs.writeFileSync(STORAGE_PATH, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error("Failed to save storage:", e);
    }
  }

  private load() {
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

  getAlerts(): Alert[] {
    return this.alerts.sort((a, b) => b.timestamp - a.timestamp);
  }

  addAlert(alert: Omit<Alert, "id" | "read">): Alert {
    const newAlert: Alert = {
      ...alert,
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      read: false,
    };
    this.alerts.unshift(newAlert);
    if (this.alerts.length > 200) {
      this.alerts = this.alerts.slice(0, 200);
    }
    this.save();
    return newAlert;
  }

  markAlertRead(id: string): boolean {
    const alert = this.alerts.find((a) => a.id === id);
    if (alert) {
      alert.read = true;
      this.save();
      return true;
    }
    return false;
  }

  markAllAlertsRead(): void {
    this.alerts.forEach((a) => (a.read = true));
    this.save();
  }

  deleteAlert(id: string): boolean {
    const idx = this.alerts.findIndex((a) => a.id === id);
    if (idx !== -1) {
      this.alerts.splice(idx, 1);
      this.save();
      return true;
    }
    return false;
  }

  clearAllAlerts(): void {
    this.alerts = [];
    this.save();
  }

  getKnownFaces(): KnownFace[] {
    return this.knownFaces;
  }

  addKnownFace(face: Omit<KnownFace, "id" | "addedAt">): KnownFace {
    const newFace: KnownFace = {
      ...face,
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      addedAt: Date.now(),
    };
    this.knownFaces.push(newFace);
    this.save();
    return newFace;
  }

  updateKnownFace(id: string, updates: Partial<KnownFace>): KnownFace | null {
    const face = this.knownFaces.find((f) => f.id === id);
    if (face) {
      Object.assign(face, updates);
      this.save();
      return face;
    }
    return null;
  }

  deleteKnownFace(id: string): boolean {
    const idx = this.knownFaces.findIndex((f) => f.id === id);
    if (idx !== -1) {
      this.knownFaces.splice(idx, 1);
      this.save();
      return true;
    }
    return false;
  }

  getStreams(): StreamConfig[] {
    return Array.from(this.streams.values());
  }

  getStream(cameraId: string): StreamConfig | null {
    return this.streams.get(cameraId) || null;
  }

  upsertStream(config: StreamConfig): void {
    this.streams.set(config.cameraId, config);
    this.save();
  }

  getSnapshot(cameraId: string): Snapshot | null {
    return this.snapshots.get(cameraId) || null;
  }

  updateSnapshot(snapshot: Snapshot): void {
    this.snapshots.set(snapshot.cameraId, snapshot);
    // Snapshots are large and volatile, better not to persist them or save them separately.
    // For now, keeping them in memory to avoid huge file sizes.
  }

  getUnreadCount(): number {
    return this.alerts.filter((a) => !a.read).length;
  }

  getProfile(): UserProfile {
    return this.profile;
  }

  updateProfile(updates: Partial<UserProfile>): UserProfile {
    Object.assign(this.profile, updates, { updatedAt: Date.now() });
    this.save();
    return this.profile;
  }
}

export const storage = new InMemoryStorage();
