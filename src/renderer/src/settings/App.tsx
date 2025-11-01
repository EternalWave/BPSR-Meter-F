import React, { useEffect, useState, useCallback } from "react";
import { useWindowControls } from "../shared/hooks";
import { useTranslations } from "../main/hooks/useTranslations";

export function SettingsApp(): React.JSX.Element {
    const { t } = useTranslations();
    const { scale, isDragging, zoomIn, zoomOut, handleDragStart, handleClose } =
        useWindowControls({
            baseWidth: 600,
            baseHeight: 420,
            windowType: "settings",
        });

    const defaultColumns: Record<string, boolean> = {
        dps: true,
        hps: true,
        totalDmg: true,
        dmgTaken: true,
        percentDmg: true,
        critPercent: true,
        critDmg: true,
        avgCritDmg: true,
        luckyPercent: true,
        peakDps: true,
        totalHeal: true,
    };

    const [visibleColumns, setVisibleColumns] =
        useState<Record<string, boolean>>(defaultColumns);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        try {
            const raw = localStorage.getItem("visibleColumns");
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === "object") {
                    setVisibleColumns((prev) => ({ ...prev, ...parsed }));
                }
            }
        } catch (e) {
            console.warn("Failed to load visibleColumns from localStorage", e);
        }
    }, []);

    const notifyVisibleColumnsUpdate = useCallback(() => {
        try {
            // write a short-lived marker to trigger storage events in other windows
            localStorage.setItem(
                "visibleColumnsUpdateMarker",
                String(Date.now()),
            );
            setTimeout(
                () => localStorage.removeItem("visibleColumnsUpdateMarker"),
                150,
            );
        } catch {}
    }, []);

    const toggleColumn = useCallback(
        (key: string) => {
            setVisibleColumns((prev) => {
                const next = { ...prev, [key]: !prev[key] };
                try {
                    localStorage.setItem(
                        "visibleColumns",
                        JSON.stringify(next),
                    );
                } catch (e) {
                    console.warn(
                        "Failed to persist visibleColumns to localStorage",
                        e,
                    );
                }
                // Notify other windows immediately
                notifyVisibleColumnsUpdate();
                return next;
            });
        },
        [notifyVisibleColumnsUpdate],
    );

    const save = useCallback(() => {
        try {
            localStorage.setItem(
                "visibleColumns",
                JSON.stringify(visibleColumns),
            );
            // notify as well so immediate sync occurs
            notifyVisibleColumnsUpdate();
            setSaved(true);
            setTimeout(() => setSaved(false), 1200);
        } catch (e) {
            console.warn("Failed to save visibleColumns to localStorage", e);
        }
    }, [visibleColumns, notifyVisibleColumnsUpdate]);

    return (
        <div className="settings-app" style={{ padding: 12 }}>
            <div
                className="controls"
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                }}
            >
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <div
                        className="drag-indicator"
                        onMouseDown={handleDragStart}
                    >
                        <i
                            className="fa-solid fa-grip-vertical"
                            style={{ fontSize: 10 }}
                        ></i>
                    </div>
                    <div className="group-title">
                        {t("ui.controls.settings", "Settings")}
                    </div>
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                    <button className="control-button" onClick={zoomOut}>
                        <i className="fa-solid fa-minus"></i>
                    </button>
                    <button className="control-button" onClick={zoomIn}>
                        <i className="fa-solid fa-plus"></i>
                    </button>
                    <button className="control-button" onClick={handleClose}>
                        <i className="fa-solid fa-xmark"></i>
                    </button>
                </div>
            </div>

            <div className="group-window" style={{ marginTop: 12 }}>
                <h4 style={{ marginTop: 0 }}>
                    {t("ui.controls.columns", "Columns")}
                </h4>
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(2, 1fr)",
                        gap: 8,
                    }}
                >
                    {Object.keys(visibleColumns).map((key) => (
                        <label
                            key={key}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                            }}
                        >
                            <input
                                type="checkbox"
                                checked={!!visibleColumns[key]}
                                onChange={() => toggleColumn(key)}
                            />
                            <span style={{ fontSize: 12 }}>
                                {t(`ui.stats.${key}`, key)}
                            </span>
                        </label>
                    ))}
                </div>

                <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                    <button className="control-button" onClick={save}>
                        {t("ui.buttons.save", "Save")}
                    </button>
                    {saved && (
                        <span
                            style={{
                                color: "#2ecc71",
                                fontWeight: 600,
                                marginLeft: 8,
                            }}
                        >
                            {t("ui.messages.saved", "Saved")}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}

export default SettingsApp;
