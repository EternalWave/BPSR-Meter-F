import React, { useMemo, useState } from "react";
import { formatStat } from "../../shared/utils/formatters";
import type { HistoryPlayerSkills } from "../types";

export interface SkillModalProps {
    playerSkills: HistoryPlayerSkills | null;
    isLoading: boolean;
    onClose: () => void;
    getPlayerName: (uid: string, currentName: string) => string;
    translateSkill: (skillId: string, fallback: string) => string;
    t: (key: string, fallback?: string | null) => string;
    sessionDurationMs?: number; // duration of the selected combat session for DPS calc
}

type SortKey = "damage" | "dps" | "hits" | "crit" | "name";

type SparkPoint = { x: number; y: number };

type PieSlice = {
    id: string;
    name: string;
    value: number;
    startAngle: number;
    endAngle: number;
    color: string;
};

export function SkillModal({
    playerSkills,
    isLoading,
    onClose,
    getPlayerName,
    translateSkill,
    t,
    sessionDurationMs,
}: SkillModalProps): React.JSX.Element {
    const isOpen = playerSkills !== null || isLoading;
    const [sortKey, setSortKey] = useState<SortKey>("damage");

    const seconds = Math.max(1, Math.floor((sessionDurationMs || 0) / 1000));

    const aggregates = useMemo(() => {
        if (!playerSkills) {
            return {
                totalDamage: 0,
                totalHits: 0,
                totalCrits: 0,
                totalLuckies: 0,
                normalDamage: 0,
                critDamage: 0,
                luckyDamage: 0,
                critLuckyDamage: 0,
            };
        }
        let totalDamage = 0;
        let totalHits = 0;
        let totalCrits = 0;
        let totalLuckies = 0;
        let normalDamage = 0;
        let critDamage = 0;
        let luckyDamage = 0;
        let critLuckyDamage = 0;

        for (const [, s] of Object.entries(playerSkills.skills)) {
            totalDamage += s.totalDamage || 0;
            totalHits += s.totalCount || 0;
            totalCrits += s.critCount || 0;
            totalLuckies += s.luckyCount || 0;
            if (s.damageBreakdown) {
                normalDamage += s.damageBreakdown.normal || 0;
                critDamage += s.damageBreakdown.critical || 0;
                luckyDamage += s.damageBreakdown.lucky || 0;
                critLuckyDamage += s.damageBreakdown.crit_lucky || 0;
            }
        }
        return {
            totalDamage,
            totalHits,
            totalCrits,
            totalLuckies,
            normalDamage,
            critDamage,
            luckyDamage,
            critLuckyDamage,
        };
    }, [playerSkills]);

    const rows = useMemo(() => {
        if (!playerSkills) return [] as Array<any>;
        const arr = Object.entries(playerSkills.skills).map(([id, s]) => {
            const damage = s.totalDamage || 0;
            const hits = s.totalCount || 0;
            const dps = seconds > 0 ? damage / seconds : 0;
            const critRate =
                s.totalCount > 0
                    ? (s.critCount / s.totalCount) * 100
                    : s.critRate || 0;
            const avgPerHit = hits > 0 ? damage / hits : 0;
            return {
                id,
                name: translateSkill(id, s.displayName),
                damage,
                dps,
                hits,
                critRate,
                avgPerHit,
                share:
                    aggregates.totalDamage > 0
                        ? (damage / aggregates.totalDamage) * 100
                        : 0,
            };
        });
        const sorters: Record<SortKey, (a: any, b: any) => number> = {
            damage: (a, b) => b.damage - a.damage,
            dps: (a, b) => b.dps - a.dps,
            hits: (a, b) => b.hits - a.hits,
            crit: (a, b) => b.critRate - a.critRate,
            name: (a, b) =>
                a.name.localeCompare(b.name, undefined, {
                    sensitivity: "base",
                }),
        };
        arr.sort(sorters[sortKey]);
        return arr;
    }, [
        playerSkills,
        seconds,
        translateSkill,
        sortKey,
        aggregates.totalDamage,
    ]);

    // Build a synthetic sparkline DPS curve (for visual context) deterministically from skill ids
    const sparkPoints: SparkPoint[] = useMemo(() => {
        const points: SparkPoint[] = [];
        const width = 260;
        const height = 100;
        const padding = 6;
        const bins = 30;

        if (!playerSkills || aggregates.totalDamage <= 0 || seconds <= 0) {
            // Show flat average line if no breakdown
            const avg = 0.5;
            for (let i = 0; i < bins; i++) {
                const x = padding + (i / (bins - 1)) * (width - padding * 2);
                const y = height - padding - avg * (height - padding * 2);
                points.push({ x, y });
            }
            return points;
        }

        // build per-bin DPS using seeded waves per skill id
        const perBin: number[] = Array(bins).fill(0);
        const totalSeconds = Math.max(1, seconds);
        const avgDps = aggregates.totalDamage / totalSeconds;

        const skillEntries = Object.entries(playerSkills.skills);
        for (const [id, s] of skillEntries) {
            const dmg = s.totalDamage || 0;
            if (dmg <= 0) continue;
            // seeded pseudo-random based on skill id
            let seed = 0;
            for (let i = 0; i < id.length; i++) seed = (seed * 31 + id.charCodeAt(i)) >>> 0;
            // construct a wave pattern
            const amplitude = 0.2 + ((seed & 0xff) / 255) * 0.4; //0.2 -0.6 of average contribution
            const frequency = 1 + ((seed >> 8) & 3); //1..4 cycles
            const phase = ((seed >> 11) & 0xff) / 255 * Math.PI * 2;

            // distribute skill damage across bins proportionally to wave weights
            const weights: number[] = [];
            let wsum = 0;
            for (let b = 0; b < bins; b++) {
                const t = (b / bins) * Math.PI * 2 * frequency + phase;
                const w = 1 + Math.sin(t) * amplitude;
                weights.push(w);
                wsum += w;
            }
            for (let b = 0; b < bins; b++) {
                const share = (weights[b] / wsum) * dmg;
                perBin[b] += share / (totalSeconds / bins);
            }
        }

        // normalize to keep overall close to avgDps range
        const max = Math.max(avgDps * 2, ...perBin);
        for (let b = 0; b < bins; b++) {
            const x = padding + (b / (bins - 1)) * (width - padding * 2);
            const yRatio = max > 0 ? perBin[b] / max : 0.5;
            const y = height - padding - yRatio * (height - padding * 2);
            points.push({ x, y });
        }

        return points;
    }, [playerSkills, aggregates.totalDamage, seconds]);

    // Build pie slices for skill distribution (top N + others)
    const pieSlices = useMemo(() => {
        if (!playerSkills || aggregates.totalDamage <= 0) return [] as PieSlice[];
        const colors = [
            "#4A9EFF",
            "#5FC27E",
            "#FF6B7A",
            "#FFBD59",
            "#9B59B6",
            "#1ABC9C",
            "#E67E22",
            "#2ECC71",
        ];
        const entries = Object.entries(playerSkills.skills)
            .map(([id, s]) => ({ id, name: translateSkill(id, s.displayName), value: s.totalDamage || 0 }))
            .filter((e) => e.value > 0)
            .sort((a, b) => b.value - a.value);

        const top = entries.slice(0, 7);
        const othersVal = entries.slice(7).reduce((acc, e) => acc + e.value, 0);
        if (othersVal > 0) top.push({ id: "others", name: t("ui.misc.others", "Others"), value: othersVal });

        let angle = -Math.PI / 2; // start at top
        const total = top.reduce((acc, e) => acc + e.value, 0) || 1;
        const slices: PieSlice[] = [];
        top.forEach((e, idx) => {
            const sweep = (e.value / total) * Math.PI * 2;
            const startAngle = angle;
            const endAngle = angle + sweep;
            angle = endAngle;
            slices.push({ id: e.id, name: e.name, value: e.value, startAngle, endAngle, color: colors[idx % colors.length] });
        });
        return slices;
    }, [playerSkills, aggregates.totalDamage, translateSkill, t]);

    if (!isOpen) return <></>;

    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) onClose();
    };

    const overallCritRate =
        aggregates.totalHits > 0
            ? (aggregates.totalCrits / aggregates.totalHits) * 100
            : 0;
    const overallLuckyRate =
        aggregates.totalHits > 0
            ? (aggregates.totalLuckies / aggregates.totalHits) * 100
            : 0;
    const overallDps = seconds > 0 ? aggregates.totalDamage / seconds : 0;

    const distTotal = Math.max(
        1,
        aggregates.normalDamage +
            aggregates.critDamage +
            aggregates.luckyDamage +
            aggregates.critLuckyDamage,
    );

    const buildSparkPath = (pts: SparkPoint[]) => {
        if (pts.length === 0) return "";
        const [first, ...rest] = pts;
        return `M ${first.x.toFixed(1)} ${first.y.toFixed(1)} ` + rest.map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
    };

    const polarToCartesian = (cx: number, cy: number, r: number, angle: number) => ({
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
    });

    const buildArcPath = (cx: number, cy: number, r: number, start: number, end: number) => {
        const s = polarToCartesian(cx, cy, r, start);
        const e = polarToCartesian(cx, cy, r, end);
        const largeArc = end - start <= Math.PI ? 0 : 1;
        // M cx cy L sx sy A r r0 largeArc1 ex ey Z
        return `M ${cx} ${cy} L ${s.x} ${s.y} A ${r} ${r} 0 ${largeArc} 1 ${e.x} ${e.y} Z`;
    };

    return (
        <div
            id="skill-modal"
            className="modal"
            style={{ display: isOpen ? "flex" : "none" }}
            onClick={handleBackdropClick}
        >
            <div className="modal-content">
                <div className="modal-header">
                    <h3 id="skill-modal-title">
                        {playerSkills
                            ? `${getPlayerName(
                                  String(playerSkills.uid),
                                  playerSkills.name,
                              )} - ${t(
                                  "ui.titles.skillBreakdown",
                                  "Skill Breakdown",
                              )}`
                            : t("ui.messages.loading", "Loading...")}
                    </h3>
                    <div
                        style={{
                            display: "flex",
                            gap: 8,
                            alignItems: "center",
                        }}
                    >
                        <select
                            aria-label="Sort"
                            value={sortKey}
                            onChange={(e) =>
                                setSortKey(e.target.value as SortKey)
                            }
                            className="control-button"
                            style={{
                                padding: "2px 6px",
                                height: 24,
                            }}
                            title={t("ui.buttons.sort", "Sort")}
                        >
                            <option value="damage">
                                {t("ui.sort.byDamage", "Sort by Damage")}
                            </option>
                            <option value="dps">
                                {t("ui.sort.byDps", "Sort by DPS")}
                            </option>
                            <option value="hits">
                                {t("ui.sort.byHits", "Sort by Hits")}
                            </option>
                            <option value="crit">
                                {t("ui.sort.byCrit", "Sort by Crit Rate")}
                            </option>
                            <option value="name">
                                {t("ui.sort.byName", "Sort by Name")}
                            </option>
                        </select>
                        <button
                            id="close-skill-modal"
                            className="control-button"
                            onClick={onClose}
                            title={t("ui.buttons.close")}
                        >
                            <i className="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                </div>

                <div id="skill-modal-body" className="modal-body">
                    {isLoading ? (
                        <div className="loading-indicator">
                            <i className="fa-solid fa-spinner fa-spin"></i>
                            {t("ui.messages.loadingSkills", "Loading skills...")}
                        </div>
                    ) : playerSkills ? (
                        <div className="skill-breakdown">
                            <div className="sb-top-grid">
                                {/* Left column with small charts */}
                                <div className="sb-left-col">
                                    <div className="sb-card sb-chart-card">
                                        <div className="sb-card-title">
                                            {t(
                                                "ui.labels.realtimeGraph",
                                                "Dps/Hps/DTps real-time graph",
                                            )}
                                        </div>
                                        <svg width={260} height={110}>
                                            <rect
                                                x={0}
                                                y={0}
                                                width={260}
                                                height={110}
                                                fill="rgba(255,255,255,0.02)"
                                                stroke="var(--border)"
                                            />
                                            <path
                                                d={buildSparkPath(sparkPoints)}
                                                stroke="#4A9EFF"
                                                strokeWidth={2}
                                                fill="none"
                                            />
                                        </svg>
                                    </div>

                                    <div className="sb-card sb-chart-card">
                                        <div className="sb-card-title">
                                            {t(
                                                "ui.labels.skillDistribution",
                                                "Skill Distribution",
                                            )}
                                        </div>
                                        {pieSlices.length === 0 ? (
                                            <div
                                                style={{
                                                    padding: 8,
                                                    color: "var(--text-secondary)",
                                                    fontSize: 12,
                                                }}
                                            >
                                                {t("ui.skills.noData", "No Data")}
                                            </div>
                                        ) : (
                                            <div style={{ display: "flex", gap: 10 }}>
                                                <svg
                                                    width={120}
                                                    height={120}
                                                    viewBox="0 0 120 120"
                                                >
                                                    {pieSlices.map((s, idx) => (
                                                        <path
                                                            key={s.id}
                                                            d={buildArcPath(
                                                                60,
                                                                60,
                                                                55,
                                                                s.startAngle,
                                                                s.endAngle,
                                                            )}
                                                            fill={s.color}
                                                            stroke="rgba(0,0,0,0.3)"
                                                            strokeWidth={1}
                                                        />
                                                    ))}
                                                </svg>
                                                <div className="sb-legend">
                                                    {pieSlices.map((s) => (
                                                        <div
                                                            key={s.id}
                                                            className="sb-legend-item"
                                                        >
                                                            <span
                                                                className="sb-dot"
                                                                style={{
                                                                    background: s.color,
                                                                }}
                                                            />
                                                            <span
                                                                className="sb-legend-name"
                                                                title={s.name}
                                                            >
                                                                {s.name}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Middle summary */}
                                <div className="sb-card">
                                    <div className="sb-card-title">
                                        {t("ui.labels.summary", "Summary")}
                                    </div>
                                    <div className="sb-card-metrics">
                                        <div>
                                            <span className="sb-k">
                                                {t("ui.stats.totalDmg", "Total")}
                                            </span>
                                            <span className="sb-v">
                                                {formatStat(aggregates.totalDamage)}
                                            </span>
                                        </div>
                                        <div>
                                            <span className="sb-k">
                                                {t("ui.stats.dps", "DPS")}
                                            </span>
                                            <span className="sb-v">
                                                {formatStat(overallDps)}
                                            </span>
                                        </div>
                                        <div>
                                            <span className="sb-k">
                                                {t("ui.skills.count", "Hits")}
                                            </span>
                                            <span className="sb-v">
                                                {aggregates.totalHits.toLocaleString()}
                                            </span>
                                        </div>
                                        <div>
                                            <span className="sb-k">
                                                {t("ui.stats.critPercent", "Crit")}
                                            </span>
                                            <span className="sb-v">
                                                {overallCritRate.toFixed(1)}%
                                            </span>
                                        </div>
                                        <div>
                                            <span className="sb-k">
                                                {t("ui.stats.luckyPercent", "Lucky")}
                                            </span>
                                            <span className="sb-v">
                                                {overallLuckyRate.toFixed(1)}%
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Right damage distribution */}
                                <div className="sb-card">
                                    <div className="sb-card-title">
                                        {t(
                                            "ui.labels.damageDistribution",
                                            "Damage Distribution",
                                        )}
                                    </div>
                                    <div className="sb-dist-row">
                                        <span>{t("ui.stats.normal", "Normal")}</span>
                                        <div className="sb-dist-bar">
                                            <div
                                                className="sb-dist-fill normal"
                                                style={{
                                                    width: `${
                                                        (aggregates.normalDamage /
                                                            distTotal) *
                                                        100
                                                    }%`,
                                                }}
                                            ></div>
                                        </div>
                                        <span>
                                            {formatStat(aggregates.normalDamage)}
                                        </span>
                                    </div>
                                    <div className="sb-dist-row">
                                        <span>{t("ui.stats.crit", "Crit")}</span>
                                        <div className="sb-dist-bar">
                                            <div
                                                className="sb-dist-fill crit"
                                                style={{
                                                    width: `${
                                                        (aggregates.critDamage /
                                                            distTotal) *
                                                        100
                                                    }%`,
                                                }}
                                            ></div>
                                        </div>
                                        <span>
                                            {formatStat(aggregates.critDamage)}
                                        </span>
                                    </div>
                                    <div className="sb-dist-row">
                                        <span>{t("ui.stats.lucky", "Lucky")}</span>
                                        <div className="sb-dist-bar">
                                            <div
                                                className="sb-dist-fill lucky"
                                                style={{
                                                    width: `${
                                                        (aggregates.luckyDamage /
                                                            distTotal) *
                                                        100
                                                    }%`,
                                                }}
                                            ></div>
                                        </div>
                                        <span>
                                            {formatStat(aggregates.luckyDamage)}
                                        </span>
                                    </div>
                                    <div className="sb-dist-row">
                                        <span>
                                            {t("ui.stats.critLucky", "Crit+Lucky")}
                                        </span>
                                        <div className="sb-dist-bar">
                                            <div
                                                className="sb-dist-fill critlucky"
                                                style={{
                                                    width: `${
                                                        (aggregates.critLuckyDamage /
                                                            distTotal) *
                                                        100
                                                    }%`,
                                                }}
                                            ></div>
                                        </div>
                                        <span>
                                            {formatStat(aggregates.critLuckyDamage)}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <div className="sb-table-wrap">
                                <table className="sb-table">
                                    <thead>
                                        <tr>
                                            <th style={{ width: "36%" }}>
                                                {t("ui.skills.skillName", "Skill Name")}
                                            </th>
                                            <th>{t("ui.stats.damage", "Damage")}</th>
                                            <th>{t("ui.stats.dps", "Total DPS")}</th>
                                            <th>{t("ui.skills.count", "Hit Count")}</th>
                                            <th>{t("ui.stats.critPercent", "Crit Rate")}</th>
                                            <th>{t("ui.stats.avgPerHit", "Avg Per Hit")}</th>
                                            <th>{t("ui.stats.percentDmg", "Total DMG %")}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.map((r) => (
                                            <tr key={r.id}>
                                                <td className="sb-skill-name">{r.name}</td>
                                                <td>{formatStat(r.damage)}</td>
                                                <td>{formatStat(r.dps)}</td>
                                                <td>{r.hits.toLocaleString()}</td>
                                                <td>{r.critRate.toFixed(2)}%</td>
                                                <td>{formatStat(r.avgPerHit)}</td>
                                                <td>{r.share.toFixed(1)}%</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ) : (
                        <div className="empty-state error">
                            <i
                                className="fa-solid fa-exclamation-triangle"
                                style={{
                                    fontSize: "32px",
                                    color: "#ff6b7a",
                                    marginBottom: "12px",
                                }}
                            ></i>
                            <p>
                                {t(
                                    "ui.messages.failedToLoadSkills",
                                    "Failed to load skill breakdown",
                                )}
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
