import { app, BrowserWindow, ipcMain, IpcMainEvent, IpcMainInvokeEvent, screen } from "electron";
import path from "path";
import { exec, fork, ChildProcess } from "child_process";
import { electronApp, is } from "@electron-toolkit/utils";
import net from "net";
import fs from "fs";

// Function to safely log to file in packaged environment
function logToFile(msg: string): void {
 // Only log in development mode
 const isDev = process.defaultApp || process.env.NODE_ENV === "development";
 if (!isDev) return;

 try {
 const userData = app.getPath("userData");
 const logPath = path.join(userData, "iniciar_log.txt");
 const timestamp = new Date().toISOString();
 fs.mkdirSync(userData, { recursive: true });
 fs.appendFileSync(logPath, `[${timestamp}] ${msg}\n`);
 console.log(msg);
 } catch (e) {
 console.error("Error writing log:", e);
 console.log(msg);
 try {
 const timestamp = new Date().toISOString();
 fs.appendFileSync("./iniciar_log.txt", `[${timestamp}] ${msg}\n`);
 } catch {}
 }
}

let mainWindow: BrowserWindow | null;
let groupWindow: BrowserWindow | null;
let historyWindow: BrowserWindow | null;
let deviceWindow: BrowserWindow | null;
let settingsWindow: BrowserWindow | null; // NEW
let serverProcess: ChildProcess | null;
let server_port: number =8989;
let lastMainWindowSize = { width:650, height:700 };
let lastGroupWindowSize = { width:480, height:530 };
let lastHistoryWindowSize = { width:800, height:600 };
let lastDeviceWindowSize = { width:600, height:400 };
let isLocked: boolean = false;
logToFile("==== ELECTRON START ====");

// Helper functions for window size & position persistence
function getSettingsPath(): string {
 const userDataPath = process.env.NODE_ENV === "development" ? process.cwd() : app.getPath("userData");
 return path.join(userDataPath, "settings.json");
}

async function loadWindowSizes(): Promise<{
 main?: { width: number; height: number; scale?: number; x?: number; y?: number };
 group?: { width: number; height: number; x?: number; y?: number };
 history?: { width: number; height: number; x?: number; y?: number };
 device?: { width: number; height: number; x?: number; y?: number };
 settings?: { width: number; height: number; scale?: number; x?: number; y?: number };
}> {
 try {
 const settingsPath = getSettingsPath();
 const data = await fs.promises.readFile(settingsPath, "utf8");
 const settings = JSON.parse(data);
 return settings.windowSizes || {};
 } catch (error) {
 logToFile("No saved window sizes found, using defaults");
 return {};
 }
}

async function saveWindowSize(
 windowType: "main" | "group" | "history" | "device" | "settings",
 width: number,
 height: number,
 scale?: number,
): Promise<void> {
 try {
 const settingsPath = getSettingsPath();
 let settings: any = {};
 try {
 const data = await fs.promises.readFile(settingsPath, "utf8");
 settings = JSON.parse(data);
 } catch {
 logToFile("Creating new settings file");
 }
 if (!settings.windowSizes) settings.windowSizes = {};
 const prev = settings.windowSizes[windowType] || {};
 settings.windowSizes[windowType] = { ...prev, width, height };
 if (scale !== undefined) settings.windowSizes[windowType].scale = scale;
 await fs.promises.writeFile(settingsPath, JSON.stringify(settings, null,4), "utf8");
 logToFile(`Saved ${windowType} window size: ${width}x${height}${scale ? ` (scale: ${scale})` : ""}`);
 } catch (error) {
 logToFile(`Error saving window size: ${error}`);
 }
}

async function saveWindowPosition(
 windowType: "main" | "group" | "history" | "device" | "settings",
 x: number,
 y: number,
): Promise<void> {
 try {
 const settingsPath = getSettingsPath();
 let settings: any = {};
 try {
 const data = await fs.promises.readFile(settingsPath, "utf8");
 settings = JSON.parse(data);
 } catch {
 logToFile("Creating new settings file");
 }
 if (!settings.windowSizes) settings.windowSizes = {};
 const prev = settings.windowSizes[windowType] || {};
 settings.windowSizes[windowType] = { ...prev, x, y };
 await fs.promises.writeFile(settingsPath, JSON.stringify(settings, null,4), "utf8");
 logToFile(`Saved ${windowType} window position: ${x},${y}`);
 } catch (error) {
 logToFile(`Error saving window position: ${error}`);
 }
}

// Function to check if a port is in use
const checkPort = (port: number): Promise<boolean> => {
 return new Promise((resolve) => {
 const server = net.createServer();
 server.once("error", () => resolve(false));
 server.once("listening", () => {
 server.close(() => resolve(true));
 });
 server.listen(port);
 });
};

async function findAvailablePort(): Promise<number> {
 let port =8989;
 logToFile("Searching for available port starting from: " + port);
 while (true) {
 logToFile("Checking port availability: " + port);
 if (await checkPort(port)) {
 logToFile("Port " + port + " is available");
 return port;
 }
 logToFile("Port " + port + " is in use, trying next...");
 port++;
 if (port >9000) {
 logToFile("ERROR: No available port found up to9000");
 throw new Error("No available ports");
 }
 }
}

async function killProcessUsingPort(port: number): Promise<void> {
 return new Promise((resolve) => {
 exec(`netstat -ano | findstr :${port}`, (error, stdout) => {
 if (stdout) {
 const lines = stdout.split("\n").filter((line) => line.includes("LISTENING"));
 if (lines.length >0) {
 const pid = lines[0].trim().split(/\s+/).pop();
 if (pid) {
 console.log(`Killing process ${pid} using port ${port}...`);
 exec(`taskkill /PID ${pid} /F`, () => resolve());
 } else resolve();
 } else resolve();
 } else resolve();
 });
 });
}

let activeWindowWatcher: NodeJS.Timeout | null = null;
let lastActiveWasTarget = false;
const TARGET_ACTIVE_SUBSTRING = "bpsr"; // case-insensitive

async function updateAlwaysOnTopByActiveWindow() {
 try {
 if (!mainWindow || mainWindow.isDestroyed()) return;
 const mod = await import("active-win");
 const getter: any = (mod as any)?.default ?? (mod as any);
 const active = await getter();
 let ownerName = "";
 if (active && active.owner) {
 ownerName = String(active.owner.name || active.owner.path || "").toLowerCase();
 }

 const shouldBeOnTop = ownerName.includes(TARGET_ACTIVE_SUBSTRING);
 if (shouldBeOnTop !== lastActiveWasTarget) {
 lastActiveWasTarget = shouldBeOnTop;
 mainWindow.setAlwaysOnTop(shouldBeOnTop, "screen-saver");
 logToFile(`ALWAYSONTOP: owner='${ownerName}' -> ${shouldBeOnTop}`);
 }
 } catch (e: any) {
 // Keep previous state if detection fails; just log the error in dev
 logToFile(`active-win failed: ${e?.message || e}`);
 }
}

function startActiveWindowWatcher() {
 if (activeWindowWatcher) return;
 // run once immediately, then every500ms
 updateAlwaysOnTopByActiveWindow();
 activeWindowWatcher = setInterval(updateAlwaysOnTopByActiveWindow,500);
}

function stopActiveWindowWatcher() {
 if (activeWindowWatcher) {
 clearInterval(activeWindowWatcher);
 activeWindowWatcher = null;
 }
}

async function createWindow(): Promise<void> {
 logToFile("=== STARTING CREATEWINDOW ===");
 logToFile("Node.js process: " + process.version);
 logToFile("Electron version: " + process.versions.electron);
 logToFile("Current directory: " + __dirname);

 logToFile("Attempting to kill processes on port8989...");
 await killProcessUsingPort(8989);

 server_port = await findAvailablePort();
 logToFile("Available port found: " + server_port);

 const savedSizes = await loadWindowSizes();
 const mainSize = savedSizes.main || { width:650, height:700 };

 const clampToWorkArea = (
 x: number,
 y: number,
 width: number,
 height: number,
): { x: number; y: number } => {
 try {
 const displays = screen.getAllDisplays();
 if (!displays || displays.length ===0) return { x, y };
 const minWorkX = Math.min(...displays.map((d) => d.workArea.x));
 const maxWorkX = Math.max(...displays.map((d) => d.workArea.x + d.workArea.width));
 const minWorkY = Math.min(...displays.map((d) => d.workArea.y));
 const maxWorkY = Math.max(...displays.map((d) => d.workArea.y + d.workArea.height));
 const clampedX = Math.min(Math.max(Math.round(x), minWorkX), Math.max(minWorkX, maxWorkX - width));
 const clampedY = Math.min(Math.max(Math.round(y), minWorkY), Math.max(minWorkY, maxWorkY - height));
 return { x: clampedX, y: clampedY };
 } catch {
 return { x, y };
 }
 };

 const mainOptions: Electron.BrowserWindowConstructorOptions = {
 width: mainSize.width,
 height: mainSize.height,
 transparent: true,
 frame: false,
 alwaysOnTop: false,
 resizable: false,
 useContentSize: false,
 webPreferences: {
 preload: path.join(__dirname, "../../out/preload/index.cjs"),
 nodeIntegration: true,
 contextIsolation: true,
 },
 icon: path.join(__dirname, "../../icon.ico"),
 };

 if (typeof mainSize.x === "number" && typeof mainSize.y === "number") {
 const pos = clampToWorkArea(mainSize.x, mainSize.y, mainOptions.width!, mainOptions.height!);
 mainOptions.x = pos.x;
 mainOptions.y = pos.y;
 }

 mainWindow = new BrowserWindow(mainOptions);

 mainWindow.setIgnoreMouseEvents(false, { forward: true });

 // Ensure window is shown
 try { mainWindow.show(); } catch {}

 // Start active window watcher to control on-top state
 startActiveWindowWatcher();

 // Persist position on move (debounced)
 let moveTimer: NodeJS.Timeout | null = null;
 mainWindow.on("move", () => {
 if (moveTimer) clearTimeout(moveTimer);
 moveTimer = setTimeout(() => {
 if (!mainWindow) return;
 const [x, y] = mainWindow.getPosition();
 saveWindowPosition("main", x, y);
 },200);
 });

 const serverPath = path.join(__dirname, "../../out/main/server.js");
 const userDataPath = app.getPath("userData");
 logToFile("User data path: " + userDataPath);
 logToFile("Launching server.js on port " + server_port + " with path: " + serverPath);

 serverProcess = fork(serverPath, [server_port.toString()], {
 stdio: ["pipe", "pipe", "pipe", "ipc"],
 execArgv: [],
 env: { ...process.env, USER_DATA_PATH: userDataPath },
 });

 let serverLoaded = false;
 const serverTimeout = setTimeout(() => {
 if (!serverLoaded && mainWindow) {
 logToFile("ERROR: Server did not respond in time (10s timeout)");
 mainWindow.loadURL('data:text/html,<h2 style="color:red">Error: Server did not respond in time.<br>Check iniciar_log.txt for details.</h2>');
 }
 },10000);

 serverProcess.stdout?.on("data", (data: Buffer) => {
 logToFile("SERVER STDOUT: " + data.toString().trim());
 const match = data.toString().match(/Web server started at (http:\/\/localhost:\d+)/);
 if (match && match[1] && mainWindow) {
 const serverUrl = match[1];
 logToFile(`Server started successfully. Loading URL: ${is.dev ? process.env["ELECTRON_RENDERER_URL"] : `${serverUrl}/index.html`}`);
 if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
 mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"] + "/index.html");
 } else {
 mainWindow.loadURL(`${serverUrl}/index.html`);
 }
 serverLoaded = true;
 clearTimeout(serverTimeout);
 }
 });

 serverProcess.stderr?.on("data", (data: Buffer) => {
 logToFile("SERVER STDERR: " + data.toString().trim());
 });

 serverProcess.on("error", (error: Error) => {
 logToFile("SERVER ERROR: " + error.message);
 logToFile("ERROR STACK: " + error.stack);
 });

 serverProcess.on("close", (code: number | null) => {
 logToFile("SERVER PROCESS CLOSED with code: " + code);
 });

 serverProcess.on("exit", (code: number | null, signal: string | null) => {
 logToFile("SERVER PROCESS EXITED with code: " + code + ", signal: " + signal);
 });

 mainWindow.on("closed", () => {
 if (groupWindow && !groupWindow.isDestroyed()) groupWindow.close();
 if (historyWindow && !historyWindow.isDestroyed()) historyWindow.close();
 if (deviceWindow && !deviceWindow.isDestroyed()) deviceWindow.close();
 if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close();
 // Stop watcher
 stopActiveWindowWatcher();

 mainWindow = null;
 if (serverProcess) {
 serverProcess.kill("SIGTERM");
 setTimeout(() => {
 if (serverProcess && !serverProcess.killed) serverProcess.kill("SIGKILL");
 },5000);
 }
 });

 // Optional: when losing focus, ensure not pinned
 mainWindow.on("blur", () => {
 try {
 lastActiveWasTarget = false;
 mainWindow?.setAlwaysOnTop(false, "screen-saver");
 } catch {}
 });

 // IPC handlers
 ipcMain.on("close-window", (event: IpcMainEvent) => {
 const win = BrowserWindow.fromWebContents(event.sender);
 win?.close();
 });

 ipcMain.on(
 "set-ignore-mouse-events",
 (event: IpcMainEvent, ignore: boolean, options?: { forward: boolean }) => {
 const win = BrowserWindow.fromWebContents(event.sender);
 win?.setIgnoreMouseEvents(ignore, options);
 },
 );

 ipcMain.handle(
 "get-window-position",
 (_event: IpcMainInvokeEvent): { x: number; y: number } => {
 const win = BrowserWindow.fromWebContents(_event.sender);
 if (win) {
 const [x, y] = win.getPosition();
 return { x, y };
 }
 return { x:0, y:0 };
 },
 );

 ipcMain.on(
 "resize-window-to-content",
 (
 _event: IpcMainEvent,
 windowType: "main" | "group" | "history" | "device" | "settings",
 width: number,
 height: number,
 ) => {
 const target =
 windowType === "main"
 ? mainWindow
 : windowType === "group"
 ? groupWindow
 : windowType === "history"
 ? historyWindow
 : windowType === "device"
 ? deviceWindow
 : settingsWindow;
 if (target && !target.isDestroyed() && width && height) {
 target.setContentSize(width, height, false);
 setTimeout(() => {
 const b = target.getBounds();
 if (windowType === "main") lastMainWindowSize = { width: b.width, height: b.height };
 if (windowType === "group") lastGroupWindowSize = { width: b.width, height: b.height };
 if (windowType === "history") lastHistoryWindowSize = { width: b.width, height: b.height };
 if (windowType === "device") lastDeviceWindowSize = { width: b.width, height: b.height };
 },10);
 }
 },
 );

 ipcMain.on(
 "save-window-size",
 (
 _event: IpcMainEvent,
 windowType: "main" | "group" | "history" | "device" | "settings",
 width: number,
 height: number,
 scale?: number,
 ) => {
 saveWindowSize(windowType, width, height, scale);
 },
 );

 ipcMain.handle("get-saved-window-sizes", async () => {
 return await loadWindowSizes();
 });

 // Lock state toggle and initial send
 ipcMain.on("toggle-lock-state", () => {
 if (!mainWindow) return;
 isLocked = !isLocked;
 try { mainWindow.setMovable(!isLocked); } catch {}
 try { mainWindow.webContents.send("lock-state-changed", isLocked); } catch {}
 });

 mainWindow.webContents.on("did-finish-load", () => {
 try { mainWindow?.webContents.send("lock-state-changed", isLocked); } catch {}
 });

 // Helper to open/focus a child window
 async function openChildWindow(
 key: "group" | "history" | "device" | "settings",
 defaults: { width: number; height: number },
 title: string,
 ): Promise<void> {
 let ref: BrowserWindow | null = null;
 if (key === "group") ref = groupWindow;
 if (key === "history") ref = historyWindow;
 if (key === "device") ref = deviceWindow;
 if (key === "settings") ref = settingsWindow;

 if (ref && !ref.isDestroyed()) {
 ref.focus();
 return;
 }

 const saved = await loadWindowSizes();
 const sz = (saved as any)[key] || defaults;

 const win = new BrowserWindow({
 width: sz.width,
 height: sz.height,
 transparent: true,
 frame: false,
 alwaysOnTop: true,
 resizable: true,
 skipTaskbar: true,
 show: false,
 useContentSize: true,
 webPreferences: {
 preload: path.join(__dirname, "../../out/preload/index.cjs"),
 nodeIntegration: true,
 contextIsolation: true,
 },
 icon: path.join(__dirname, "../../icon.ico"),
 title,
 });

 try { win.setAlwaysOnTop(true, "screen-saver"); } catch {}
 try { win.setIgnoreMouseEvents(false); } catch {}

 if (typeof sz.x === "number" && typeof sz.y === "number") {
 try { win.setPosition(sz.x, sz.y, false); } catch {}
 }

 win.once("ready-to-show", () => { try { win.show(); } catch {} });
 win.on("closed", () => {
 if (key === "group") groupWindow = null;
 if (key === "history") historyWindow = null;
 if (key === "device") deviceWindow = null;
 if (key === "settings") settingsWindow = null;
 });

 if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
 win.loadURL(process.env["ELECTRON_RENDERER_URL"] + `/${key}.html`);
 } else {
 win.loadURL(`http://localhost:${server_port}/${key}.html`);
 }

 if (key === "group") groupWindow = win;
 if (key === "history") historyWindow = win;
 if (key === "device") deviceWindow = win;
 if (key === "settings") settingsWindow = win;
 }

 // IPC to open child windows
 ipcMain.on("open-group-window", async () => {
 await openChildWindow("group", { width:480, height:530 }, "Group Management");
 });
 ipcMain.on("open-history-window", async () => {
 await openChildWindow("history", { width:1125, height:875 }, "Combat History");
 });
 ipcMain.on("open-device-window", async () => {
 await openChildWindow("device", { width:600, height:420 }, "Select Network Device");
 });
 ipcMain.on("open-settings-window", async () => {
 await openChildWindow("settings", { width:600, height:420 }, "Settings");
 });
}

app.whenReady()
 .then(() => {
 electronApp.setAppUserModelId("com.electron");
 logToFile("Electron app ready, starting createWindow()");
 createWindow();
 app.on("activate", () => {
 logToFile("App activated");
 if (BrowserWindow.getAllWindows().length ===0) {
 logToFile("No windows found, creating new window");
 createWindow();
 }
 });
 })
 .catch((error: Error) => {
 logToFile("ERROR in app.whenReady(): " + error.message);
 logToFile("ERROR STACK: " + error.stack);
 });

app.on("window-all-closed", () => {
 logToFile("All windows closed");
 if (process.platform !== "darwin") {
 logToFile("Closing application (not macOS)");
 app.quit();
 }
});

app.on("before-quit", () => {
 logToFile("App closing, cleaning up processes...");
});
