import { useState, useEffect, useCallback, useRef } from "react";
import { useInterval } from "../../shared/hooks";
import type {
    ViewMode,
    SortColumn,
    SortDirection,
    ManualGroupState,
} from "../../shared/types";

export interface PlayerUser {
    uid: number;
    name: string;
    profession: string;
    total_damage: {
        normal: number;
        critical: number;
        lucky: number;
        crit_lucky: number;
        hpLessen: number;
        total: number;
    };
    total_count: {
        normal: number;
        critical: number;
        lucky: number;
        crit_lucky: number;
        total: number;
    };
    total_healing: {
        normal: number;
        critical: number;
        lucky: number;
        crit_lucky: number;
        hpLessen: number;
        total: number;
    };
    taken_damage: number;
    total_dps: number;
    total_hps: number;
    realtime_dps_max: number;
    hp: number;
    max_hp: number;
    fightPoint: number;
    damagePercent?: number;
}

export interface SkillData {
    displayName: string;
    type: string;
    elementype: string;
    totalDamage: number;
    totalCount: number;
    critCount: number;
    luckyCount: number;
    critRate: number;
    luckyRate: number;
    damageBreakdown: {
        normal: number;
        critical: number;
        lucky: number;
        crit_lucky: number;
        hpLessen: number;
        total: number;
    };
    countBreakdown: {
        normal: number;
        critical: number;
        lucky: number;
        crit_lucky: number;
        total: number;
    };
}

export interface SkillsDataByUser {
    [uid: string]: {
        uid: number;
        name: string;
        profession: string;
        skills: {
            [skillId: string]: SkillData;
        };
    };
}

export interface UseDataFetchingOptions {
    viewMode: ViewMode;
    sortColumn: SortColumn;
    sortDirection: SortDirection;
    manualGroupState: ManualGroupState | null;
    onServerReset?: () => void;
    showAllPlayers?: boolean;
}

export interface UseDataFetchingReturn {
    players: PlayerUser[];
    skillsData: SkillsDataByUser | null;
    localUid: number | null;
    isLoading: boolean;
    isPaused: boolean;
    togglePause: () => Promise<void>;
    startTime: number; // server session start time
    lastPausedAt: number | null;
    totalPausedMs: number;
    encounterStartTime: number | null; // begins on first combat detected
    pausedBaselineMs: number; // server totalPausedMs snapshot when encounter started
    activeBossId?: number | null;
    activeBossName?: string | null;
    activeEnemyId?: number | null;
    activeEnemyName?: string | null;
}

// keep previous values if undefined in payload
function coalesce<T>(val: T | undefined, prev: T): T {
    return (val === undefined ? prev : val) as T;
}

export function useDataFetching(
    options: UseDataFetchingOptions,
): UseDataFetchingReturn {
    const {
        viewMode,
        sortColumn,
        sortDirection,
        manualGroupState,
        onServerReset,
        showAllPlayers,
    } = options;

    const [players, setPlayers] = useState<PlayerUser[]>([]);
    const [skillsData, setSkillsData] = useState<SkillsDataByUser | null>(null);
    const [localUid, setLocalUid] = useState<number | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [isPaused, setIsPaused] = useState<boolean>(false);
    const [startTime, setStartTime] = useState<number>(Date.now());
    const [lastPausedAt, setLastPausedAt] = useState<number | null>(null);
    const [totalPausedMs, setTotalPausedMs] = useState<number>(0);
    const [encounterStartTime, setEncounterStartTime] = useState<number | null>(
        null,
    );
    const [activeBossId, setActiveBossId] = useState<number | null>(null);
    const [activeBossName, setActiveBossName] = useState<string | null>(null);
    const [activeEnemyId, setActiveEnemyId] = useState<number | null>(null);
    const [activeEnemyName, setActiveEnemyName] = useState<string | null>(null);
    const pausedBaselineMsRef = useRef<number>(0);

    const lastStartTimeRef = useRef<number>(0);
    const lastTotalDamageRef = useRef<number>(0);

    useEffect(() => {
        const syncPauseState = async () => {
            try {
                const resp = await fetch("/api/pause");
                const json = await resp.json();
                if (json && typeof json.paused === "boolean") {
                    setIsPaused(json.paused);
                    setLastPausedAt(json.lastPausedAt ?? null);
                    setTotalPausedMs(
                        typeof json.totalPausedMs === "number"
                            ? json.totalPausedMs
                            : 0,
                    );
                }
            } catch (err) {
                console.error("Failed to fetch server pause state:", err);
            }
        };

        syncPauseState();
    }, []);

    const togglePause = useCallback(async () => {
        const newPausedState = !isPaused;
        setIsPaused(newPausedState);

        try {
            const resp = await fetch("/api/pause", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ paused: newPausedState }),
            });
            const json = await resp.json();

            if (json && typeof json.paused === "boolean") {
                setIsPaused(json.paused);
                setLastPausedAt(json.lastPausedAt ?? null);
                setTotalPausedMs(
                    typeof json.totalPausedMs === "number"
                        ? json.totalPausedMs
                        : 0,
                );
            }
        } catch (err) {
            console.error("Failed to update server pause state:", err);
        }
    }, [isPaused]);

    // Main data fetching function
    const fetchData = useCallback(async () => {
        try {
            if (viewMode === "skills") {
                const skillsRes = await fetch("/api/skills");
                const skillsDataRes = await skillsRes.json();

                if (
                    skillsDataRes.code === 0 &&
                    skillsDataRes.data &&
                    skillsDataRes.data.skills
                ) {
                    // boss/enemy id/name may be absent occasionally; coalesce
                    setActiveBossId((prev) =>
                        coalesce<number | null>(
                            skillsDataRes.activeBossId,
                            prev,
                        ),
                    );
                    setActiveBossName((prev) =>
                        coalesce<string | null>(
                            skillsDataRes.activeBossName,
                            prev,
                        ),
                    );
                    setActiveEnemyId((prev) =>
                        coalesce<number | null>(
                            skillsDataRes.activeEnemyId,
                            prev,
                        ),
                    );
                    setActiveEnemyName((prev) =>
                        coalesce<string | null>(
                            skillsDataRes.activeEnemyName,
                            prev,
                        ),
                    );

                    setSkillsData(skillsDataRes.data.skills);
                    setStartTime(skillsDataRes.startTime || Date.now());
                    setIsLoading(
                        Object.keys(skillsDataRes.data.skills).length === 0,
                    );

                    // Determine local uid for skills view (optional)
                    try {
                        const localUserResponse = await fetch("/api/solo-user");
                        const localUserData = await localUserResponse.json();
                        if (
                            localUserData.user &&
                            Object.keys(localUserData.user).length > 0
                        ) {
                            const currentLocalUid = parseInt(
                                Object.keys(localUserData.user)[0],
                                10,
                            );
                            setLocalUid(currentLocalUid);
                        }
                    } catch {}

                    // Start timer on first detected combat in skills view
                    if (encounterStartTime == null) {
                        const hasCombat = Object.values(
                            skillsDataRes.data.skills || {},
                        ).some((u: any) =>
                            Object.values(u.skills || {}).some(
                                (sk: any) =>
                                    (sk.totalDamage || 0) > 0 ||
                                    (sk.totalCount || 0) > 0,
                            ),
                        );
                        if (hasCombat) {
                            setEncounterStartTime(Date.now());
                            pausedBaselineMsRef.current = totalPausedMs;
                        }
                    }
                } else {
                    setSkillsData(null);
                    setIsLoading(true);
                }
                return;
            }

            const apiEndpoint =
                viewMode === "solo" ? "/api/solo-user" : "/api/data";
            const response = await fetch(apiEndpoint);
            const userData = await response.json();

            setActiveBossId((prev) =>
                coalesce<number | null>(userData.activeBossId, prev),
            );
            setActiveBossName((prev) =>
                coalesce<string | null>(userData.activeBossName, prev),
            );
            setActiveEnemyId((prev) =>
                coalesce<number | null>(userData.activeEnemyId, prev),
            );
            setActiveEnemyName((prev) =>
                coalesce<string | null>(userData.activeEnemyName, prev),
            );

            // remember server session start (may change on zone/server reset)
            if (userData.startTime) {
                setStartTime(userData.startTime);
            }

            if (
                userData.startTime &&
                userData.startTime !== lastStartTimeRef.current
            ) {
                // Reset encounter on server reset
                lastStartTimeRef.current = userData.startTime;
                lastTotalDamageRef.current = 0;
                setEncounterStartTime(null);
                pausedBaselineMsRef.current = 0;
                onServerReset?.();
            }

            // Build full list first (used for encounter/timer detection)
            const allUsers: PlayerUser[] = Object.entries(
                userData.user || {},
            ).map(([uid, data]: [string, any]) => ({
                ...data,
                uid: parseInt(uid, 10),
            }));

            // If no users yet, keep waiting
            if (!allUsers || allUsers.length === 0) {
                setPlayers([]);
                setIsLoading(true);
                return;
            }

            // Encounter detection uses the full dataset (damage/heal/taken)
            const sumaTotalDamageAll = allUsers.reduce(
                (acc: number, u: PlayerUser) =>
                    acc +
                    (u.total_damage?.total ? Number(u.total_damage.total) : 0),
                0,
            );

            const sumTotalHealingAll = allUsers.reduce(
                (acc: number, u: PlayerUser) =>
                    acc +
                    (u.total_healing?.total
                        ? Number(u.total_healing.total)
                        : 0),
                0,
            );

            const sumTakenAll = allUsers.reduce(
                (acc: number, u: PlayerUser) =>
                    acc + (Number(u.taken_damage) || 0),
                0,
            );

            // Start timer on first detected combat in nearby/solo views
            if (encounterStartTime == null) {
                const hasCombat =
                    sumaTotalDamageAll + sumTotalHealingAll + sumTakenAll > 0;
                if (hasCombat) {
                    setEncounterStartTime(Date.now());
                    pausedBaselineMsRef.current = totalPausedMs;
                }
            }

            if (sumaTotalDamageAll !== lastTotalDamageRef.current) {
                lastTotalDamageRef.current = sumaTotalDamageAll;
            }

            // Filter to only active combatants (dealt >0 damage)
            let userArray: PlayerUser[] = allUsers.filter(
                (u) => Number(u.total_damage?.total || 0) > 0,
            );

            // If none are active, show empty list but keep polling in background (no spinner)
            if (userArray.length === 0) {
                setPlayers([]);
                setIsLoading(false);
                return;
            }

            // compute percentages relative to filtered combatants only
            const sumaTotalDamage = userArray.reduce(
                (acc: number, u: PlayerUser) =>
                    acc +
                    (u.total_damage?.total ? Number(u.total_damage.total) : 0),
                0,
            );

            userArray.forEach((u: PlayerUser) => {
                const userDamage = u.total_damage?.total
                    ? Number(u.total_damage.total)
                    : 0;
                u.damagePercent =
                    sumaTotalDamage > 0
                        ? Math.max(
                              0,
                              Math.min(
                                  100,
                                  (userDamage / sumaTotalDamage) * 100,
                              ),
                          )
                        : 0;
            });

            sortUserArray(userArray, sortColumn, sortDirection);

            // Nearby view: optionally limit to top10
            let finalArray = userArray;
            if (viewMode === "nearby" && !showAllPlayers) {
                const top10 = userArray.slice(0, 10);
                finalArray = top10;
            }

            setPlayers(finalArray);
        } catch (err) {
            console.error("Error in fetchData:", err);
            setPlayers([]);
            setIsLoading(true);
        }
    }, [
        viewMode,
        sortColumn,
        sortDirection,
        manualGroupState,
        onServerReset,
        showAllPlayers,
        isPaused,
        totalPausedMs,
        encounterStartTime,
    ]);

    useInterval(fetchData, isPaused ? null : 50);

    return {
        players,
        skillsData,
        localUid,
        isLoading,
        isPaused,
        togglePause,
        startTime,
        lastPausedAt,
        totalPausedMs,
        encounterStartTime,
        pausedBaselineMs: pausedBaselineMsRef.current,
        activeBossId,
        activeBossName,
        activeEnemyId,
        activeEnemyName,
    };
}

function sortUserArray(
    userArray: PlayerUser[],
    sortColumn: SortColumn,
    sortDirection: SortDirection,
): void {
    userArray.sort((a, b) => {
        let aVal: number, bVal: number;

        switch (sortColumn) {
            case "totalDmg":
                aVal = a.total_damage?.total ? Number(a.total_damage.total) : 0;
                bVal = b.total_damage?.total ? Number(b.total_damage.total) : 0;
                break;
            case "totalDmgTaken":
                aVal = Number(a.taken_damage) || 0;
                bVal = Number(b.taken_damage) || 0;
                break;
            case "totalHeal":
                aVal = a.total_healing?.total
                    ? Number(a.total_healing.total)
                    : 0;
                bVal = b.total_healing?.total
                    ? Number(b.total_healing.total)
                    : 0;
                break;
            case "realtimeDps":
                aVal = Number(a.total_dps) || 0;
                bVal = Number(b.total_dps) || 0;
                break;
            default:
                aVal = a.total_damage?.total ? Number(a.total_damage.total) : 0;
                bVal = b.total_damage?.total ? Number(b.total_damage.total) : 0;
        }

        return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
    });
}
