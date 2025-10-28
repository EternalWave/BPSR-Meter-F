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
    startTime: number; // server session start time (may reflect zone change)
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

    const lastStartTimeRef = useRef<number>(0);
    const lastTotalDamageRef = useRef<number>(0);

    useEffect(() => {
        const syncPauseState = async () => {
            try {
                const resp = await fetch("/api/pause");
                const json = await resp.json();
                if (json && typeof json.paused === "boolean") {
                    setIsPaused(json.paused);
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
                    skillsDataRes.code ===0 &&
                    skillsDataRes.data &&
                    skillsDataRes.data.skills
                ) {
                    setSkillsData(skillsDataRes.data.skills);
                    setStartTime(skillsDataRes.startTime || Date.now());
                    setIsLoading(
                        Object.keys(skillsDataRes.data.skills).length ===0,
                    );

                    // Determine local uid for skills view (optional)
                    try {
                        const localUserResponse = await fetch("/api/solo-user");
                        const localUserData = await localUserResponse.json();
                        if (
                            localUserData.user &&
                            Object.keys(localUserData.user).length >0
                        ) {
                            const currentLocalUid = parseInt(
                                Object.keys(localUserData.user)[0],
                                10,
                            );
                            setLocalUid(currentLocalUid);
                        }
                    } catch {}

                } else {
                    setSkillsData(null);
                    setIsLoading(true);
                }
                return;
            }

            const apiEndpoint = viewMode === "solo" ? "/api/solo-user" : "/api/data";
            const response = await fetch(apiEndpoint);
            const userData = await response.json();

            // remember server session start (may change on zone/server reset)
            if (userData.startTime) {
                setStartTime(userData.startTime);
            }

            if (
                userData.startTime &&
                userData.startTime !== lastStartTimeRef.current
            ) {
                // Reset encounter and baselines on server reset
                lastStartTimeRef.current = userData.startTime;
                lastTotalDamageRef.current =0;
                onServerReset?.();
            }

            let userArray: PlayerUser[] = Object.entries(userData.user || {}).map(
                ([uid, data]: [string, any]) => ({
                    ...data,
                    uid: parseInt(uid,10),
                }),
            );

            // If no users yet, keep waiting
            if (!userArray || userArray.length ===0) {
                setPlayers([]);
                setIsLoading(true);
                return;
            }

            // Keep all players; compute combat totals from raw numbers
            setIsLoading(false);

            const sumaTotalDamage = userArray.reduce(
                (acc: number, u: PlayerUser) =>
                    acc + (u.total_damage?.total ? Number(u.total_damage.total) :0),
                0,
            );

            const sumTotalHealing = userArray.reduce(
                (acc: number, u: PlayerUser) =>
                    acc + (u.total_healing?.total ? Number(u.total_healing.total) :0),
                0,
            );

            const sumTaken = userArray.reduce(
                (acc: number, u: PlayerUser) => acc + (Number(u.taken_damage) ||0),
                0,
            );

            if (sumaTotalDamage !== lastTotalDamageRef.current) {
                lastTotalDamageRef.current = sumaTotalDamage;
            }

            // compute percentages safely
            userArray.forEach((u: PlayerUser) => {
                const userDamage = u.total_damage?.total ? Number(u.total_damage.total) :0;
                u.damagePercent = sumaTotalDamage >0
                    ? Math.max(0, Math.min(100, (userDamage / sumaTotalDamage) *100))
                    :0;
            });

            sortUserArray(userArray, sortColumn, sortDirection);

            // Nearby view: optionally limit to top10 + local
            let finalArray = userArray;
            if (viewMode === "nearby" && !showAllPlayers) {
                const top10 = userArray.slice(0,10);
                let list = top10;
                try {
                    const localUserResponse = await fetch("/api/solo-user");
                    const localUserData = await localUserResponse.json();
                    const localKey = localUserData.user ? Object.keys(localUserData.user)[0] : undefined;
                    const localId = localKey ? parseInt(localKey,10) : undefined;
                    if (localId && !top10.some((u) => u.uid === localId)) {
                        const extra = userArray.find((u) => u.uid === localId);
                        if (extra) list = [...top10, extra];
                    }
                } catch {}
                finalArray = list;
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
    ]);

    useInterval(fetchData, isPaused ? null :50);

    return {
        players,
        skillsData,
        localUid,
        isLoading,
        isPaused,
        togglePause,
        startTime,
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
                aVal = a.total_damage?.total ? Number(a.total_damage.total) :0;
                bVal = b.total_damage?.total ? Number(b.total_damage.total) :0;
                break;
            case "totalDmgTaken":
                aVal = Number(a.taken_damage) ||0;
                bVal = Number(b.taken_damage) ||0;
                break;
            case "totalHeal":
                aVal = a.total_healing?.total ? Number(a.total_healing.total) :0;
                bVal = b.total_healing?.total ? Number(b.total_healing.total) :0;
                break;
            case "realtimeDps":
                aVal = Number(a.total_dps) ||0;
                bVal = Number(b.total_dps) ||0;
                break;
            default:
                aVal = a.total_damage?.total ? Number(a.total_damage.total) :0;
                bVal = b.total_damage?.total ? Number(b.total_damage.total) :0;
        }

        return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
    });
}
