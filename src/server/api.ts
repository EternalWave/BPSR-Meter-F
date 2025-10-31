import express, { Express, Request, Response } from "express";
import cors from "cors";
import path from "path";
import { promises as fsPromises } from "fs";
import { Server as HTTPServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import cap from "cap";
import type { Logger, GlobalSettings, ApiResponse, PlayerRegistry } from "../types/index";
import type { UserDataManager } from "./dataManager";
import Sniffer from "./sniffer";

// Use user data path in production, current directory in development
const USER_DATA_DIR = process.env.NODE_ENV === "development" ? process.cwd() : process.env.USER_DATA_PATH;
const SETTINGS_PATH = path.join(USER_DATA_DIR, "settings.json");
const PLAYER_REGISTRY_PATH = path.join(USER_DATA_DIR, "player_registry.json");

const LanguageChangeGracePeriod = 5000; // 5 seconds

// Boss IDs to auto-reset on combat start
const BOSS_IDS = new Set<number>([
783, // Goblin
425, // Tina
185, // Tower
38, // Kanima
103588, // Dark Mist Fortress
1985, // Dragon Claw Valley
15179, // Frost Ogre
146, // Arachnocrab
15395, // Tempest Ogre
15323, // Muku Chief
15269, // Brigand Leader
15159, // Golden Juggernaut
15202, // Inferno Ogre
87, // Lizardman King
147, // Venobzzar Incubator
]);

interface ErrorWithCode extends Error {
 code?: string;
}

// helper to compute active enemy by highest total damage >0
function computeActiveEnemy(enemies: Record<string, any>): { id: number; name: string; type?: string | null; isBoss?: boolean } | null {
 const all = Object.entries(enemies || {}) as Array<[string, any]>;
 const entries = all.filter(([, e]) => Number(e?.stats?.total) >0);
 if (entries.length ===0) return null;
 entries.sort((a, b) => (Number(b[1]?.stats?.total) ||0) - (Number(a[1]?.stats?.total) ||0));
 const [id, e] = entries[0];
 const eid = parseInt(id,10);
 return { id: eid, name: e?.name || String(eid), type: e?.type ?? null, isBoss: !!e?.isBoss };
}

function initializeApi(
 app: Express,
 server: HTTPServer,
 io: SocketIOServer,
 userDataManager: UserDataManager,
 logger: Logger,
 globalSettings: GlobalSettings,
 playerRegistry: PlayerRegistry,
 sniffer?: Sniffer,
): void {
 app.use(cors());
 app.use(express.json());

 if (process.env.NODE_ENV !== "development") {
 app.use(express.static(path.join(__dirname, "..", "renderer")));

 app.get("/icon.png", (req: Request, res: Response) => {
 res.sendFile(path.join(__dirname, "..", "renderer", "icon.png"));
 });

 app.get("/favicon.ico", (req: Request, res: Response) => {
 res.sendFile(path.join(__dirname, "..", "renderer", "favicon.ico"));
 });
 }

 // These will be updated by the boss detector interval below
 let inBossEncounter = false;
 let activeBossId: number | null = null;
 let activeBossName: string | null = null;
 let lastBossSeenAt: number | null = null;
 const BOSS_LOST_GRACE_MS =5000;
 let lastActiveEnemyId: number | null = null;

 app.get("/api/data", (req: Request, res: Response) => {
 const userData = userDataManager.getAllUsersData();
 const enemies = userDataManager.getAllEnemiesData?.() || {};
 const ae = computeActiveEnemy(enemies);
 const data: ApiResponse = {
 code:0,
 user: userData,
 timestamp: Date.now(),
 startTime: userDataManager.startTime,
 } as any;
 (data as any).activeBossId = activeBossId;
 (data as any).activeBossName = activeBossName;
 (data as any).activeEnemyId = ae?.id ?? null;
 (data as any).activeEnemyName = ae?.name ?? null;
 (data as any).activeEnemyType = ae?.type ?? null;
 (data as any).activeEnemyIsBoss = ae?.isBoss ?? false;
 res.json(data);
 });

 app.get("/api/solo-user", (req: Request, res: Response) => {
 const soloData = userDataManager.getSoloUserData();
 const enemies = userDataManager.getAllEnemiesData?.() || {};
 const ae = computeActiveEnemy(enemies);
 const data: ApiResponse = {
 code:0,
 user: soloData,
 timestamp: Date.now(),
 startTime: userDataManager.startTime,
 } as any;
 (data as any).activeBossId = activeBossId;
 (data as any).activeBossName = activeBossName;
 (data as any).activeEnemyId = ae?.id ?? null;
 (data as any).activeEnemyName = ae?.name ?? null;
 (data as any).activeEnemyType = ae?.type ?? null;
 (data as any).activeEnemyIsBoss = ae?.isBoss ?? false;
 res.json(data);
 });

 app.get("/api/debug/status", (req: Request, res: Response) => {
 const allUsers = userDataManager.getAllUsersData();
 const localUid = userDataManager.localPlayerUid;
 const userCount = Object.keys(allUsers).length;
 const enemies = userDataManager.getAllEnemiesData?.() || {};
 const ae = computeActiveEnemy(enemies);

 res.json({
 code:0,
 localPlayerUid: localUid,
 totalUsersTracked: userCount,
 userIds: Object.keys(allUsers),
 hasLocalPlayer: localUid ? allUsers.hasOwnProperty(localUid) : false,
 activeBossId,
 activeBossName,
 activeEnemyId: ae?.id ?? null,
 activeEnemyName: ae?.name ?? null,
 activeEnemyType: ae?.type ?? null,
 activeEnemyIsBoss: ae?.isBoss ?? false,
 });
 });

 app.get("/api/enemies", (req: Request, res: Response) => {
 const enemiesData = userDataManager.getAllEnemiesData();
 const ae = computeActiveEnemy(enemiesData);
 const data: ApiResponse = {
 code:0,
 enemy: enemiesData,
 } as any;
 (data as any).activeBossId = activeBossId;
 (data as any).activeBossName = activeBossName;
 (data as any).activeEnemyId = ae?.id ?? null;
 (data as any).activeEnemyName = ae?.name ?? null;
 (data as any).activeEnemyType = ae?.type ?? null;
 (data as any).activeEnemyIsBoss = ae?.isBoss ?? false;
 res.json(data);
 });

 app.get("/api/clear", async (req: Request, res: Response) => {
 await userDataManager.clearAll();
 // Reset pause accounting for new session
 try {
 (globalSettings as any).totalPausedMs =0;
 globalSettings.lastPausedAt = null;
 globalSettings.lastResumedAt = null;
 await fsPromises.writeFile(
 SETTINGS_PATH,
 JSON.stringify(globalSettings, null,4),
 "utf8",
 );
 } catch {}
 console.log("Statistics cleared!");
 res.json({
 code:0,
 msg: "Statistics cleared!",
 });
 });

 app.get("/api/reset", async (req: Request, res: Response) => {
 await userDataManager.resetStatistics();
 // Reset pause accounting for new session
 try {
 (globalSettings as any).totalPausedMs =0;
 globalSettings.lastPausedAt = null;
 globalSettings.lastResumedAt = null;
 await fsPromises.writeFile(
 SETTINGS_PATH,
 JSON.stringify(globalSettings, null,4),
 "utf8",
 );
 } catch {}
 console.log("Statistics reset (keeping player info)!");
 res.json({
 code:0,
 msg: "Statistics reset!",
 });
 });

 app.post("/api/pause", (req: Request, res: Response) => {
 const { paused } = req.body;
 const now = Date.now();

 if (paused) {
 // Entering paused state
 if (!globalSettings.isPaused) {
 globalSettings.isPaused = true;
 globalSettings.lastPausedAt = now;
 }
 } else {
 // Leaving paused state
 if (globalSettings.isPaused) {
 globalSettings.isPaused = false;
 const lastPausedAt = globalSettings.lastPausedAt || null;
 if (typeof (globalSettings as any).totalPausedMs !== "number") {
 (globalSettings as any).totalPausedMs =0;
 }
 if (lastPausedAt && lastPausedAt >0) {
 (globalSettings as any).totalPausedMs += Math.max(0, now - lastPausedAt);
 }
 globalSettings.lastResumedAt = now;
 globalSettings.lastPausedAt = null;
 }
 }

 console.log(`Statistics ${globalSettings.isPaused ? "paused" : "resumed"}!`);

 // Persist settings so timestamps survive restarts
 (async () => {
 try {
 await fsPromises.writeFile(
 SETTINGS_PATH,
 JSON.stringify(globalSettings, null,4),
 "utf8",
 );
 } catch (err) {
 console.error("Failed to persist settings after pause toggle:", err);
 }
 })();

 res.json({
 code:0,
 msg: `Statistics ${globalSettings.isPaused ? "paused" : "resumed"}!`,
 paused: globalSettings.isPaused,
 lastPausedAt: globalSettings.lastPausedAt || null,
 lastResumedAt: globalSettings.lastResumedAt || null,
 totalPausedMs:
 typeof (globalSettings as any).totalPausedMs === "number"
 ? (globalSettings as any).totalPausedMs
 :0,
 });
 });

 app.get("/api/pause", (req: Request, res: Response) => {
 res.json({
 code:0,
 paused: globalSettings.isPaused,
 lastPausedAt: globalSettings.lastPausedAt || null,
 lastResumedAt: globalSettings.lastResumedAt || null,
 totalPausedMs:
 typeof (globalSettings as any).totalPausedMs === "number"
 ? (globalSettings as any).totalPausedMs
 :0,
 });
 });

 app.post("/api/set-username", (req: Request, res: Response) => {
 const { uid, name } = req.body;
 if (uid && name) {
 const userId = parseInt(uid,10);
 if (!isNaN(userId)) {
 userDataManager.setName(userId, name);
 console.log(`Manually assigned name '${name}' to UID ${userId}`);
 res.json({ code:0, msg: "Username updated successfully." });
 } else {
 res.status(400).json({ code:1, msg: "Invalid UID." });
 }
 } else {
 res.status(400).json({ code:1, msg: "Missing UID or name." });
 }
 });

 app.get("/api/skill/:uid", (req: Request, res: Response) => {
 const uid = parseInt(req.params.uid);
 const skillData = userDataManager.getUserSkillData(uid);

 if (!skillData) {
 return res.status(404).json({
 code:1,
 msg: "User not found",
 });
 }

 res.json({
 code:0,
 data: skillData,
 });
 });

 app.get("/api/skills", (req: Request, res: Response) => {
 const userData = userDataManager.getAllUsersData();
 const enemies = userDataManager.getAllEnemiesData?.() || {};
 const ae = computeActiveEnemy(enemies);
 const skillsData: Record<string, any> = {};

 for (const [uid, user] of Object.entries(userData)) {
 if (
 (user as any).total_damage && (user as any).total_damage.total >0 ||
 (user as any).taken_damage >0 ||
 (user as any).total_healing && (user as any).total_healing.total >0
 ) {
 skillsData[uid] = userDataManager.getUserSkillData(parseInt(uid));
 }
 }

 const data: ApiResponse = {
 code:0,
 data: { skills: skillsData },
 timestamp: Date.now(),
 startTime: userDataManager.startTime,
 } as any;
 (data as any).activeBossId = activeBossId;
 (data as any).activeBossName = activeBossName;
 (data as any).activeEnemyId = ae?.id ?? null;
 (data as any).activeEnemyName = ae?.name ?? null;
 (data as any).activeEnemyType = ae?.type ?? null;
 (data as any).activeEnemyIsBoss = ae?.isBoss ?? false;
 res.json(data);
 });

 // List available capture devices (npcap/pcap)
 app.get("/api/devices", (req: Request, res: Response) => {
 try {
 const devices = cap.Cap.deviceList();
 const simplified = (devices || []).map((d: any, idx: number) => ({
 id: idx,
 name: d.name,
 description: d.description || "",
 addresses: d.addresses || [],
 }));
 res.json({ code:0, data: simplified });
 } catch (err) {
 logger.error("Failed to enumerate devices:", err);
 res.status(500).json({ code:1, msg: "Failed to enumerate devices" });
 }
 });

 // Get or set selected device in settings
 app.get("/api/device", async (req: Request, res: Response) => {
 try {
 res.json({ code:0, data: { selectedDevice: globalSettings.selectedDevice || null } });
 } catch (err) {
 res.status(500).json({ code:1, msg: "Failed to read device setting" });
 }
 });

 app.post("/api/device", async (req: Request, res: Response) => {
 try {
 const { selectedDevice } = req.body;
 globalSettings.selectedDevice = selectedDevice;

 await fsPromises.writeFile(SETTINGS_PATH, JSON.stringify(globalSettings, null,4), "utf8");

 await sniffer.stop();
 await sniffer.start(selectedDevice !== undefined ? selectedDevice : "auto", sniffer.getPacketProcessor());

 res.json({ code:0, data: { selectedDevice } });
 } catch (err) {
 logger.error("Failed to persist selected device:", err);
 res.status(500).json({ code:1, msg: "Failed to persist selected device" });
 }
 });

 app.get(
 "/api/history/:timestamp/summary",
 async (req: Request, res: Response) => {
 const { timestamp } = req.params;
 const historyFilePath = path.join(
 USER_DATA_DIR,
 "logs",
 timestamp,
 "summary.json",
 );

 try {
 const data = await fsPromises.readFile(historyFilePath, "utf8");
 const summaryData = JSON.parse(data);
 res.json({
 code: 0,
 data: summaryData,
 });
 } catch (error) {
 const err = error as ErrorWithCode;
 if (err.code === "ENOENT") {
 logger.warn("History summary file not found:", error);
 res.status(404).json({
 code: 1,
 msg: "History summary file not found",
 });
 } else {
 logger.error("Failed to read history summary file:", error);
 res.status(500).json({
 code: 1,
 msg: "Failed to read history summary file",
 });
 }
 }
 },
 );

 app.get(
 "/api/history/:timestamp/data",
 async (req: Request, res: Response) => {
 const { timestamp } = req.params;
 const historyFilePath = path.join(
 USER_DATA_DIR,
 "logs",
 timestamp,
 "allUserData.json",
 );

 try {
 const data = await fsPromises.readFile(historyFilePath, "utf8");
 const userData = JSON.parse(data);
 res.json({
 code: 0,
 user: userData,
 });
 } catch (error) {
 const err = error as ErrorWithCode;
 if (err.code === "ENOENT") {
 logger.warn("History data file not found:", error);
 res.status(404).json({
 code: 1,
 msg: "History data file not found",
 });
 } else {
 logger.error("Failed to read history data file:", error);
 res.status(500).json({
 code: 1,
 msg: "Failed to read history data file",
 });
 }
 }
 },
 );

 app.get(
 "/api/history/:timestamp/skill/:uid",
 async (req: Request, res: Response) => {
 const { timestamp, uid } = req.params;
 const historyFilePath = path.join(
 USER_DATA_DIR,
 "logs",
 timestamp,
 "users",
 `${uid}.json`,
 );

 try {
 const data = await fsPromises.readFile(historyFilePath, "utf8");
 const skillData = JSON.parse(data);
 res.json({
 code: 0,
 data: skillData,
 });
 } catch (error) {
 const err = error as ErrorWithCode;
 if (err.code === "ENOENT") {
 logger.warn("History skill file not found:", error);
 res.status(404).json({
 code: 1,
 msg: "History skill file not found",
 });
 } else {
 logger.error("Failed to read history skill file:", error);
 res.status(500).json({
 code: 1,
 msg: "Failed to load history skill file",
 });
 }
 }
 },
 );

 app.get(
 "/api/history/:timestamp/download",
 async (req: Request, res: Response) => {
 const { timestamp } = req.params;
 const historyFilePath = path.join(
 USER_DATA_DIR,
 "logs",
 timestamp,
 "fight.log",
 );
 res.download(historyFilePath, `fight_${timestamp}.log`);
 },
 );

 app.get("/api/history/list", async (req: Request, res: Response) => {
 try {
 const logsDir = path.join(USER_DATA_DIR, "logs");
 const data = (
 await fsPromises.readdir(logsDir, { withFileTypes: true })
 )
 .filter((e) => e.isDirectory() && /^\d+$/.test(e.name))
 .map((e) => e.name);
 res.json({
 code: 0,
 data: data,
 });
 } catch (error) {
 const err = error as ErrorWithCode;
 if (err.code === "ENOENT") {
 logger.warn("History path not found:", error);
 res.status(404).json({
 code: 1,
 msg: "History path not found",
 });
 } else {
 logger.error("Failed to load history path:", error);
 res.status(500).json({
 code:1,
 msg: "Failed to load history path",
 });
 }
 }
 });

 app.get("/api/settings", async (req: Request, res: Response) => {
 res.json({ code:0, data: globalSettings });
 });

 app.post("/api/settings", async (req: Request, res: Response) => {
 const newSettings = req.body;
 Object.assign(globalSettings, newSettings);
 await fsPromises.writeFile(
 SETTINGS_PATH,
 JSON.stringify(globalSettings, null,4),
 "utf8",
 );
 res.json({ code:0, data: globalSettings });
 });

 app.get("/api/translations/:lang", async (req: Request, res: Response) => {
 const { lang } = req.params;
 const translationPath = process.env.NODE_ENV === 'development' ?
 path.join(__dirname, "..", "..", "translations", `${lang}.json`) :
 path.join(__dirname, "translations", `${lang}.json`);
 try {
 const data = await fsPromises.readFile(translationPath, "utf8");
 res.json({
 code:0,
 data: JSON.parse(data),
 });
 } catch (error) {
 const err = error as ErrorWithCode;
 if (err.code === "ENOENT") {
 res.status(404).json({
 code:1,
 msg: "Translation file not found",
 });
 } else {
 logger.error("Failed to read translation file:", error);
 res.status(500).json({
 code:1,
 msg: "Failed to load translation",
 });
 }
 }
 });

 app.post("/api/language", async (req: Request, res: Response) => {
 const { language } = req.body;

 if (!language || !globalSettings.availableLanguages?.includes(language)) {
 return res.status(400).json({
 code:1,
 msg: "Invalid language",
 });
 }

 globalSettings.language = language;
 try {
 userDataManager.reloadTranslations?.(language);
 } catch {}
 await fsPromises.writeFile(
 SETTINGS_PATH,
 JSON.stringify(globalSettings, null,4),
 "utf8",
 );

 res.json({
 code:0,
 data: { language: globalSettings.language },
 });
 });

 app.get("/api/manual-group", (req: Request, res: Response) => {
 res.json({
 code:0,
 data: {
 enabled: (globalSettings as any).manualGroup?.enabled || false,
 members: (globalSettings as any).manualGroup?.members || [],
 },
 });
 });

 app.post("/api/manual-group", async (req: Request, res: Response) => {
 if (!(globalSettings as any).manualGroup) {
 (globalSettings as any).manualGroup = { enabled: false, members: [] };
 }

 const { enabled, members } = req.body;
 (globalSettings as any).manualGroup.enabled = enabled;
 (globalSettings as any).manualGroup.members = members;

 await fsPromises.writeFile(
 SETTINGS_PATH,
 JSON.stringify(globalSettings, null,4),
 "utf8",
 );

 res.json({
 code:0,
 data: {
 enabled: (globalSettings as any).manualGroup.enabled,
 members: (globalSettings as any).manualGroup.members,
 },
 });
 });

 app.post("/api/manual-group/add", async (req: Request, res: Response) => {
 const { uid, name } = req.body;

 if (!uid) {
 return res.status(400).json({
 code:1,
 msg: "UID is required",
 });
 }

 if (!(globalSettings as any).manualGroup) {
 (globalSettings as any).manualGroup = { enabled: false, members: [] };
 }

 const exists = (globalSettings as any).manualGroup.members.some(
 (m: any) => m.uid === uid,
 );
 if (exists) {
 return res.status(400).json({
 code:1,
 msg: "Player already in group",
 });
 }

 (globalSettings as any).manualGroup.members.push({
 uid,
 name: name || "Unknown",
 });

 await fsPromises.writeFile(
 SETTINGS_PATH,
 JSON.stringify(globalSettings, null,4),
 "utf8",
 );

 console.log(`Added player ${name || uid} to manual group`);

 res.json({
 code:0,
 data: {
 enabled: (globalSettings as any).manualGroup.enabled,
 members: (globalSettings as any).manualGroup.members,
 },
 });
 });

 app.post(
 "/api/manual-group/remove",
 async (req: Request, res: Response) => {
 const { uid } = req.body;

 if (!uid) {
 return res.status(400).json({
 code:1,
 msg: "UID is required",
 });
 }

 if (!(globalSettings as any).manualGroup) {
 (globalSettings as any).manualGroup = { enabled: false, members: [] };
 }

 (globalSettings as any).manualGroup.members = (globalSettings as any).manualGroup.members.filter((m: any) => m.uid !== uid);
 await fsPromises.writeFile(
 SETTINGS_PATH,
 JSON.stringify(globalSettings, null,4),
 "utf8",
 );

 console.log(`Removed player ${uid} from manual group`);

 res.json({
 code:0,
 data: {
 enabled: (globalSettings as any).manualGroup.enabled,
 members: (globalSettings as any).manualGroup.members,
 },
 });
 },
 );

 app.post("/api/manual-group/clear", async (req: Request, res: Response) => {
 if (!(globalSettings as any).manualGroup) {
 (globalSettings as any).manualGroup = { enabled: false, members: [] };
 }

 (globalSettings as any).manualGroup.members = [];
 await fsPromises.writeFile(
 SETTINGS_PATH,
 JSON.stringify(globalSettings, null,4),
 "utf8",
 );

 console.log("Cleared manual group members");

 res.json({
 code:0,
 data: {
 enabled: (globalSettings as any).manualGroup.enabled,
 members: [],
 },
 });
 });

 app.get("/api/player-registry", (req: Request, res: Response) => {
 if (!playerRegistry) {
 playerRegistry = {} as any;
 }
 res.json({
 code:0,
 data: playerRegistry,
 });
 });

 app.post(
 "/api/player-registry/save",
 async (req: Request, res: Response) => {
 const { uid, name } = req.body;

 if (!uid || !name) {
 return res.status(400).json({
 code:1,
 msg: "UID and name are required",
 });
 }

 if (!playerRegistry) {
 playerRegistry = {} as any;
 }

 (playerRegistry as any)[uid] = { name };
 await fsPromises.writeFile(
 PLAYER_REGISTRY_PATH,
 JSON.stringify(playerRegistry, null,4),
 "utf8",
 );

 console.log(`Saved player: ${uid} -> ${name}`);

 res.json({
 code:0,
 data: playerRegistry,
 });
 },
 );

 app.post(
 "/api/player-registry/delete",
 async (req: Request, res: Response) => {
 const { uid } = req.body;

 if (!uid) {
 return res.status(400).json({
 code:1,
 msg: "UID is required",
 });
 }

 if (!playerRegistry) {
 playerRegistry = {} as any;
 }

 delete (playerRegistry as any)[uid];
 await fsPromises.writeFile(
 PLAYER_REGISTRY_PATH,
 JSON.stringify(playerRegistry, null,4),
 "utf8",
 );

 console.log(`Deleted player: ${uid}`);

 res.json({
 code:0,
 data: playerRegistry,
 });
 },
 );

 app.post(
 "/api/player-registry/auto-update",
 async (req: Request, res: Response) => {
 if (!playerRegistry) {
 playerRegistry = {} as any;
 }

 const userData = userDataManager.getAllUsersData();
 let updated = false;

 for (const [uid, player] of Object.entries(userData)) {
 if (
 (player as any).name &&
 (player as any).name !== "Unknown" &&
 (player as any).name.trim() !== ""
 ) {
 const uidStr = String(uid);
 if ((playerRegistry as any)[uidStr] && (playerRegistry as any)[uidStr].name !== (player as any).name) {
 console.log(
 `Auto-updated player name: ${uid} from "${(playerRegistry as any)[uidStr].name}" to "${(player as any).name}"`,
 );
 (playerRegistry as any)[uidStr].name = (player as any).name;
 updated = true;
 }
 }
 }

 if (updated) {
 await fsPromises.writeFile(
 PLAYER_REGISTRY_PATH,
 JSON.stringify(playerRegistry, null,4),
 "utf8",
 );
 }

 res.json({
 code:0,
 data: { updated, registry: playerRegistry },
 });
 },
 );

 io.on("connection", (socket) => {
 console.log("WebSocket client connected: " + socket.id);

 socket.on("disconnect", () => {
 console.log("WebSocket client disconnected: " + socket.id);
 });
 });

 // Boss detection and data broadcast interval
 setInterval(() => {
 try {
 const enemies = userDataManager.getAllEnemiesData?.() || {};
 const entries = Object.entries(enemies) as Array<[string, any]>;
 const now = Date.now();

 if (!inBossEncounter) {
 const bossWithCombat = entries.find(([id, e]) => {
 const eid = parseInt(id,10);
 const isBoss = BOSS_IDS.has(eid);
 const hasCombat = !!(e?.stats?.total && e.stats.total >0);
 return isBoss && hasCombat;
 });
 if (bossWithCombat) {
 inBossEncounter = true;
 activeBossId = parseInt(bossWithCombat[0],10);
 activeBossName = bossWithCombat[1]?.name || String(activeBossId);
 lastBossSeenAt = now;
 (async () => {
 try {
 // Preserve player data; only reset combat statistics
 await userDataManager.resetStatistics();
 (globalSettings as any).totalPausedMs =0;
 globalSettings.lastPausedAt = null;
 globalSettings.lastResumedAt = null;
 await fsPromises.writeFile(
 SETTINGS_PATH,
 JSON.stringify(globalSettings, null,4),
 "utf8",
 );
 console.log(`Boss ${activeBossId} (${activeBossName}) detected. Statistics reset for new encounter (players preserved).`);
 } catch (e) {
 console.error("Failed to reset statistics on boss start:", e);
 }
 })();
 }
 } else {
 const bossStillSeen = entries.some(([id]) => parseInt(id,10) === activeBossId);
 if (bossStillSeen) {
 lastBossSeenAt = now;
 } else if (lastBossSeenAt && now - lastBossSeenAt > BOSS_LOST_GRACE_MS) {
 inBossEncounter = false;
 activeBossId = null;
 activeBossName = null;
 lastBossSeenAt = null;
 }
 }
 } catch (e) {
 // ignore detection errors
 }

 if (!globalSettings.isPaused) {
 const userData = userDataManager.getAllUsersData();
 const enemies = userDataManager.getAllEnemiesData?.() || {};
 const ae = computeActiveEnemy(enemies);
 const data: ApiResponse = { code:0, user: userData } as any;
 (data as any).activeBossId = activeBossId;
 (data as any).activeBossName = activeBossName;
 (data as any).activeEnemyId = ae?.id ?? null;
 (data as any).activeEnemyName = ae?.name ?? null;
 (data as any).activeEnemyType = ae?.type ?? null;
 (data as any).activeEnemyIsBoss = ae?.isBoss ?? false;
 io.emit("data", data);
 }
 },100);
}

export default initializeApi;
