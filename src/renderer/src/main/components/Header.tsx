import React, { useEffect, useState } from "react";

export interface HeaderProps {
 title: string;
 onZoomIn?: () => void;
 onZoomOut?: () => void;
 onClose?: () => void;
 startTime?: number;
 t: (key: string, fallback?: string | null) => string;
}

function formatElapsed(ms: number): string {
 if (ms <0) return "00:00";
 const total = Math.floor(ms /1000);
 const h = Math.floor(total /3600);
 const m = Math.floor((total %3600) /60);
 const s = total %60;
 const pad = (n: number) => n.toString().padStart(2, "0");
 return h >0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function Header({ title, onZoomIn, onZoomOut, onClose, startTime, t }: HeaderProps): React.JSX.Element {
 const [, setTick] = useState(0);
 useEffect(() => {
 const id = window.setInterval(() => setTick((x) => x +1),1000);
 return () => window.clearInterval(id);
 }, []);

 const elapsed = startTime ? Date.now() - startTime :0;

 return (
 <div className="controls">
 <div className="drag-indicator" title={t("ui.buttons.drag","Drag window")}> 
 <i className="fa-solid fa-grip-vertical"></i>
 </div>
 <div className="title" style={{ marginRight: "auto" }}>{title}</div>
 <div className="encounter-timer" title={t("ui.labels.encounterTimer","Encounter time")}
 style={{ fontSize:11, color: "var(--text-secondary)", marginRight:8 }}>
 ? {formatElapsed(elapsed)}
 </div>
 {onZoomOut && (
 <button className="control-button" onClick={onZoomOut} title={t("ui.buttons.zoomOut")}>
 <i className="fa-solid fa-magnifying-glass-minus"></i>
 </button>
 )}
 {onZoomIn && (
 <button className="control-button" onClick={onZoomIn} title={t("ui.buttons.zoomIn")}>
 <i className="fa-solid fa-magnifying-glass-plus"></i>
 </button>
 )}
 {onClose && (
 <button className="control-button close-button" onClick={onClose} title={t("ui.buttons.close")}> 
 <i className="fa-solid fa-xmark"></i>
 </button>
 )}
 </div>
 );
}

export default Header;
