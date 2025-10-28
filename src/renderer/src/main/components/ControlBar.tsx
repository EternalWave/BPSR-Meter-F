import React from "react";
import { DragIndicator } from "./DragIndicator";
import type { ViewMode, SortColumn } from "../../shared/types";

export interface ControlBarProps {
    // Window controls
    isLocked: boolean;
    onToggleLock: () => void;
    onClose: () => void;
    onDragStart: (e: React.MouseEvent) => void;

    // View mode controls
    viewMode: ViewMode;
    onToggleViewMode: () => void;
    onToggleSkillsMode: () => void;

    // Sorting controls
    sortColumn: SortColumn;
    onSortChange: (column: SortColumn) => void;
    // Nearby list controls
    showAllPlayers?: boolean;
    onToggleShowAll?: () => void;

    // Action controls
    onSync: () => void;
    isPaused: boolean;
    onTogglePause: () => void;

    // Language control
    currentLanguage: string;
    onLanguageToggle: () => void;

    // Window controls
    onOpenGroup: () => void;
    onOpenHistory: () => void;
    onZoomIn: () => void;
    onZoomOut: () => void;

    // Encounter timer
    startTime?: number; // session start (unused for display now)
    encounterStartTime?: number | null; // first combat activity time

    // Translations
    t: (key: string, fallback?: string | null) => string;
    visibleColumns?: Record<string, boolean>;
    onToggleColumn?: (key: string) => void;
    skillsScope?: "solo" | "nearby";
    onToggleSkillsScope?: () => void;
}

function formatElapsed(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return "00:00";
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n: number) => n.toString().padStart(2, "0");
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function ControlBar(props: ControlBarProps): React.JSX.Element {
    const isNearby = props.viewMode === "nearby";
    const isSkills = props.viewMode === "skills";

    // Opacity slider state and positioning
    const [showOpacity, setShowOpacity] = React.useState(false);
    const [opacity, setOpacity] = React.useState<number>(1);
    const [panelPos, setPanelPos] = React.useState<{ top: number; left: number }>({ top: 0, left: 0 });
    const opacityBtnRef = React.useRef<HTMLButtonElement | null>(null);

    // tick each second to refresh timer
    const [, setTick] = React.useState(0);
    React.useEffect(() => {
        const id = window.setInterval(() => setTick((x) => x + 1), 1000);
        return () => window.clearInterval(id);
    }, []);

    React.useEffect(() => {
        try {
            const raw = localStorage.getItem("windowOpacity");
            let val = 1;
            if (raw != null) {
                const parsed = parseFloat(raw);
                if (!Number.isNaN(parsed)) {
                    val = Math.max(0, Math.min(1, parsed));
                }
            }
            setOpacity(val);
            document.documentElement.style.setProperty("--content-opacity", String(val));
        } catch {
            setOpacity(1);
            document.documentElement.style.setProperty("--content-opacity", "1");
        }
    }, []);

    const applyOpacity = (val: number) => {
        const clamped = Math.max(0, Math.min(1, val));
        setOpacity(clamped);
        try {
            document.documentElement.style.setProperty("--content-opacity", String(clamped));
            localStorage.setItem("windowOpacity", String(clamped));
        } catch {}
    };

    const updatePanelPosition = React.useCallback(() => {
        const btn = opacityBtnRef.current;
        if (!btn) return;
        const r = btn.getBoundingClientRect();
        const estimatedWidth = 180; // approximate popup width
        const left = Math.max(8, r.right - estimatedWidth);
        const top = r.bottom + 8;
        setPanelPos({ top, left });
    }, []);

    React.useEffect(() => {
        if (!showOpacity) return;
        updatePanelPosition();
        const onWin = () => updatePanelPosition();
        window.addEventListener("resize", onWin);
        window.addEventListener("scroll", onWin, true);
        return () => {
            window.removeEventListener("resize", onWin);
            window.removeEventListener("scroll", onWin, true);
        };
    }, [showOpacity, updatePanelPosition]);

    const elapsed = props.encounterStartTime ? Date.now() - props.encounterStartTime : 0;

    return (
        <div className="controls gap-1">
            {/* Drag Indicator */}
            <DragIndicator onDragStart={props.onDragStart} isLocked={props.isLocked} />

            {/* Sync/Reset Button */}
            <button
                id="sync-button"
                className="sync-button"
                onClick={props.onSync}
                title={props.t("ui.buttons.resetStatistics")}
            >
                <i className="fa-solid fa-rotate-right sync-icon"></i>
            </button>

            {/* Pause Button */}
            <button
                id="pause-button"
                className="control-button"
                onClick={props.onTogglePause}
                title={props.isPaused ? props.t("ui.buttons.resumeUpdates") : props.t("ui.buttons.pauseUpdates")}
            >
                <i className={`fa-solid fa-${props.isPaused ? "play" : "pause"}`}></i>
            </button>

            {/* Group Button */}
            <button
                id="group-btn"
                className="control-button group"
                onClick={props.onOpenGroup}
                title={props.t("ui.buttons.openGroup")}
            >
                <i className="fa-solid fa-users"></i>
            </button>

            {/* Device Picker Button */}
            <button
                id="device-btn"
                className="control-button advanced-lite-btn"
                onClick={() => (window as any).electronAPI?.openDeviceWindow?.()}
                title={props.t("ui.buttons.openDevicePicker", "Select Network Device")}
            >
                <i className="fa-solid fa-network-wired"></i>
            </button>

            {/* History Button */}
            <button
                id="history-btn"
                className="control-button advanced-lite-btn"
                onClick={props.onOpenHistory}
                title={props.t("ui.buttons.openHistory")}
            >
                <i className="fa-solid fa-clock-rotate-left"></i>
            </button>

            {/* Settings Button */}
            <button
                id="settings-btn"
                className="control-button advanced-lite-btn"
                onClick={() => (window as any).electronAPI?.openSettingsWindow?.()}
                title={props.t("ui.buttons.openSettings", "Settings")}
            >
                <i className="fa-solid fa-gear"></i>
            </button>

            {/* Skills View Toggle */}
            <button
                id="skills-btn"
                className={`control-button advanced-lite-btn ${props.viewMode === "skills" ? "active" : ""}`}
                onClick={props.onToggleSkillsMode}
                title={props.t("ui.buttons.toggleSkillsView")}
            >
                <i className="fa-solid fa-chart-line mr-2"></i> {props.t("ui.controls.skills")}
            </button>

            {/* Encounter timer */}
            <div
                className="encounter-timer"
                title={props.t("ui.labels.encounterTimer", "Encounter time (starts on combat)")}
                style={{ fontSize: 11, color: "var(--text-secondary)", margin: "08px" }}
            >
                ⏱ {formatElapsed(elapsed)}
            </div>

            <div className="flex gap-1 mx-auto">
                {/* Nearby/Solo Toggle */}
                <button
                    id="nearby-group-btn"
                    className={`control-button advanced-lite-btn`}
                    onClick={() => {
                        if (props.viewMode === "skills") {
                            props.onToggleSkillsScope && props.onToggleSkillsScope();
                        } else {
                            props.onToggleViewMode();
                        }
                    }}
                    title={
                        props.viewMode === "nearby"
                            ? props.t("ui.buttons.switchToSoloMode")
                            : props.t("ui.buttons.switchToNearbyMode")
                    }
                >
                    {props.viewMode === "skills"
                        ? props.skillsScope === "nearby"
                            ? props.t("ui.controls.nearby")
                            : props.t("ui.controls.solo")
                        : props.viewMode === "nearby"
                        ? props.t("ui.controls.nearby")
                        : props.t("ui.controls.solo")}
                </button>

                {/* If in skills view, hide sort controls */}
                {!isSkills && (
                    <>
                        <button
                            id="sort-dmg-btn"
                            className={`sort-button ${props.sortColumn === "totalDmg" ? "active" : ""}`}
                            onClick={() => isNearby && props.onSortChange("totalDmg")}
                            title={props.t("ui.buttons.sortDamage")}
                            disabled={!isNearby}
                            style={{ opacity: isNearby ? 1 : 0.4, cursor: isNearby ? "pointer" : "not-allowed" }}
                        >
                            DMG
                        </button>
                        <button
                            id="sort-tank-btn"
                            className={`sort-button ${props.sortColumn === "totalDmgTaken" ? "active" : ""}`}
                            onClick={() => isNearby && props.onSortChange("totalDmgTaken")}
                            title={props.t("ui.buttons.sortDamageTaken")}
                            disabled={!isNearby}
                            style={{ opacity: isNearby ? 1 : 0.4, cursor: isNearby ? "pointer" : "not-allowed" }}
                        >
                            Tank
                        </button>
                        <button
                            id="sort-heal-btn"
                            className={`sort-button ${props.sortColumn === "totalHeal" ? "active" : ""}`}
                            onClick={() => isNearby && props.onSortChange("totalHeal")}
                            title={props.t("ui.buttons.sortHealing")}
                            disabled={!isNearby}
                            style={{ opacity: isNearby ? 1 : 0.4, cursor: isNearby ? "pointer" : "not-allowed" }}
                        >
                            Heal
                        </button>
                        {/* Show Top10 / All toggle - rendered but disabled outside nearby mode */}
                        <button
                            id="toggle-top10-all"
                            className={`control-button advanced-lite-btn ${props.showAllPlayers ? "active" : ""}`}
                            onClick={() => isNearby && props.onToggleShowAll && props.onToggleShowAll()}
                            title={props.t("ui.buttons.toggleTop10All")}
                            disabled={!isNearby}
                            style={{ opacity: isNearby ? 1 : 0.4, cursor: isNearby ? "pointer" : "not-allowed" }}
                        >
                            {props.showAllPlayers ? props.t("ui.controls.showAll") : props.t("ui.controls.showTop10")}
                        </button>
                    </>
                )}
            </div>

            <div className="flex gap-1 ml-2">
                {/* Zoom Controls */}
                <div className="flex gap-1">
                    <button
                        id="zoom-out-btn"
                        className="control-button"
                        onClick={props.onZoomOut}
                        title={props.t("ui.buttons.zoomOut")}
                        disabled={props.isLocked}
                        style={{
                            opacity: props.isLocked ? 0.3 : 1,
                            cursor: props.isLocked ? "not-allowed" : "pointer",
                        }}
                    >
                        <i className="fa-solid fa-minus"></i>
                    </button>
                    <button
                        id="zoom-in-btn"
                        className="control-button"
                        onClick={props.onZoomIn}
                        title={props.t("ui.buttons.zoomIn")}
                        disabled={props.isLocked}
                        style={{
                            opacity: props.isLocked ? 0.3 : 1,
                            cursor: props.isLocked ? "not-allowed" : "pointer",
                        }}
                    >
                        <i className="fa-solid fa-plus"></i>
                    </button>
                </div>

                {/* Language Toggle */}
                <button
                    id="language-btn"
                    className="control-button"
                    onClick={props.onLanguageToggle}
                    title={
                        props.currentLanguage === "en"
                            ? "切换到中文"
                            : "Switch to English"
                    }
                >
                    <span style={{ fontSize: "10px", fontWeight: 600 }}>
                        {props.currentLanguage === "en" ? "EN" : "中"}
                    </span>
                </button>

                {/* Opacity control */}
                <div style={{ position: "relative" }}>
                    <button
                        id="opacity-btn"
                        ref={opacityBtnRef}
                        className="control-button"
                        onClick={() => setShowOpacity((s) => !s)}
                        title={props.t("ui.buttons.opacity", "Window Opacity")}
                    >
                        <i className="fa-solid fa-eye-dropper"></i>
                    </button>
                    {showOpacity && (
                        <div style={{ position: "fixed", left: panelPos.left, top: panelPos.top, background: "var(--bg-darker)", border: "1px solid var(--border)", padding: 8, borderRadius: 4, zIndex: 9999 }}>
                            <input
                                type="range"
                                min={0}
                                max={1}
                                step={0.01}
                                value={opacity}
                                onChange={(e) => applyOpacity(parseFloat(e.target.value))}
                            />
                        </div>
                    )}
                </div>

                {/* Lock Button */}
                <button
                    id="lock-button"
                    className="control-button"
                    onClick={props.onToggleLock}
                    title={props.isLocked ? props.t("ui.buttons.unlockWindow") : props.t("ui.buttons.lockWindow")}
                >
                    <i
                        className={`fa-solid fa-${props.isLocked ? "lock" : "lock-open"}`}
                    ></i>
                </button>

                {/* Close Button */}
                <button
                    id="close-button"
                    className="control-button"
                    onClick={props.onClose}
                    title={props.t("ui.buttons.close")}
                    style={{
                        opacity: props.isLocked ? 0.3 : 1,
                        cursor: props.isLocked ? "not-allowed" : "pointer",
                        pointerEvents: props.isLocked ? "none" : "auto",
                    }}
                >
                    <i className="fa-solid fa-xmark"></i>
                </button>
            </div>
        </div>
    );
}
