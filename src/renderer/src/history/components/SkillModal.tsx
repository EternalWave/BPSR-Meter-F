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

    if (!isOpen) {
        return <></>;
    }

    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
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
                            <div className="sb-summary-grid">
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
