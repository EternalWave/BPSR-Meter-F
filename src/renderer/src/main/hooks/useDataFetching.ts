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
    encounterStartTime?: number | null; // starts when combat activity begins (any combat data)
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
    const [encounterStartTime, setEncounterStartTime] = useState<number | null>(
        null,
    );

    const lastStartTimeRef = useRef<number>(0);
    const lastTotalDamageRef = useRef<number>(0);
    // kept for potential future use, but no longer gates timer start
    const prevAggRef = useRef<{
        init: boolean;
        dmg: number;
        heal: number;
        taken: number;
        skillMetric: number;
    }>({
        init: false,
        dmg:0,
        heal:0,
        taken:0,
        skillMetric:0,
    });

    const prevLocalRef = useRef<{
        uid: number | null;
        init: boolean;
        dmg: number;
        heal: number;
        taken: number;
        skillMetric: number;
    }>({
        uid: null,
        init: false,
        dmg:0,
        heal:0,
        taken:0,
        skillMetric:0,
    });

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

                    // Determine local uid for skills view
                    let currentLocalUid: number | null = null;
                    try {
                        const localUserResponse = await fetch("/api/solo-user");
                        const localUserData = await localUserResponse.json();
                        if (
                            localUserData.user &&
                            Object.keys(localUserData.user).length >0
                        ) {
                            currentLocalUid = parseInt(
                                Object.keys(localUserData.user)[0],
                                10,
                            );
                            setLocalUid(currentLocalUid);
                        }
                    } catch (err) {}

                    // If any skill data shows combat (any damage or count), start timer if not started
                    if (!encounterStartTime) {
                        const hasCombat = Object.values(skillsDataRes.data.skills || {}).some(
                            (u: any) =>
                                Object.values(u.skills || {}).some(
                                    (sk: any) => (sk.totalDamage ||0) >0 || (sk.totalCount ||0) >0,
                                ),
                        );
                        if (hasCombat) {
                            setEncounterStartTime(Date.now());
                        }
                    }
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
                console.log("Server reset detected. Clearing local encounter start.");
                lastStartTimeRef.current = userData.startTime;
                lastTotalDamageRef.current =0;
                setEncounterStartTime(null); // do not start automatically on reset
                prevAggRef.current = { init: false, dmg:0, heal:0, taken:0, skillMetric:0 }; // re-init aggregates
                prevLocalRef.current = { uid: null, init: false, dmg:0, heal:0, taken:0, skillMetric:0 }; // reset local aggregates
                onServerReset?.();
            }

            let userArray: PlayerUser[] = Object.entries(userData.user).map(
                ([uid, data]: [string, any]) => ({
                    ...data,
                    uid: parseInt(uid,10),
                }),
            );

            userArray = userArray.filter(
                (u: PlayerUser) =>
                    (u.total_damage && u.total_damage.total >0) ||
                    u.taken_damage >0 ||
                    (u.total_healing && u.total_healing.total >0),
            );

            if (
                manualGroupState &&
                manualGroupState.enabled &&
                manualGroupState.members &&
                manualGroupState.members.length >0
            ) {
                const groupUids = manualGroupState.members;
                userArray = userArray.filter((u: PlayerUser) =>
                    groupUids.includes(String(u.uid)),
                );
                console.log(
                    `Manual group filter applied: ${userArray.length} players in group`,
                );
            }

            if (!userArray || userArray.length ===0) {
                setPlayers([]);
                setIsLoading(true);
                return;
            }

            setIsLoading(false);

            const sumaTotalDamage = userArray.reduce(
                (acc: number, u: PlayerUser) =>
                    acc +
                    (u.total_damage && u.total_damage.total
                        ? Number(u.total_damage.total)
                        :0),
                0,
            );

            const sumTotalHealing = userArray.reduce(
                (acc: number, u: PlayerUser) =>
                    acc +
                    (u.total_healing && u.total_healing.total
                        ? Number(u.total_healing.total)
                        :0),
                0,
            );

            const sumTaken = userArray.reduce(
                (acc: number, u: PlayerUser) => acc + (Number(u.taken_damage) ||0),
                0,
            );

            // Start timer once combat data is received (any damage/heal/taken)
            if (!encounterStartTime) {
                const totalCombat = sumaTotalDamage + sumTotalHealing + sumTaken;
                if (totalCombat >0) {
                    setEncounterStartTime(Date.now());
                }
            }

            // Determine or refresh local uid
            let currentLocalUid: number | null = null;
            if (viewMode === "solo") {
                const uidKey = Object.keys(userData.user)[0];
                currentLocalUid = uidKey ? parseInt(uidKey,10) : null;
            } else {
                try {
                    const localUserResponse = await fetch("/api/solo-user");
                    const localUserData = await localUserResponse.json();
                    if (
                        localUserData.user &&
                        Object.keys(localUserData.user).length >0
                    ) {
                        currentLocalUid = parseInt(
                            Object.keys(localUserData.user)[0],
                            10,
                        );
                    }
                } catch (err) {
                    console.log("Could not get local user:", err);
                }
            }

            setLocalUid(currentLocalUid);

            if (sumaTotalDamage !== lastTotalDamageRef.current) {
                lastTotalDamageRef.current = sumaTotalDamage;
            }

            userArray.forEach((u: PlayerUser) => {
                const userDamage =
                    u.total_damage && u.total_damage.total
                        ? Number(u.total_damage.total)
                        : 0;
                u.damagePercent =
                    sumaTotalDamage >0
                        ? Math.max(
                              0,
                              Math.min(
                                  100,
                                  (userDamage / sumaTotalDamage) *100,
                              ),
                          )
                        : 0;
            });

            sortUserArray(userArray, sortColumn, sortDirection);

            let finalArray = userArray;
            if (viewMode === "nearby") {
                if (showAllPlayers) {
                    finalArray = userArray;
                } else {
                    const top10 = userArray.slice(0,10);
                    const isLocalInTop10 = currentLocalUid
                        ? top10.some((u: PlayerUser) => u.uid === currentLocalUid)
                        : false;

                    if (userArray.length >10 && !isLocalInTop10 && currentLocalUid) {
                        const localUserExtra = userArray.find(
                            (u: PlayerUser) => u.uid === currentLocalUid,
                        );
                        if (localUserExtra) {
                            finalArray = [...top10, localUserExtra];
                        } else {
                            finalArray = top10;
                        }
                    } else {
                        finalArray = top10;
                    }
                }
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
        encounterStartTime,
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
        encounterStartTime,
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
                aVal = a.total_healing?.total
                    ? Number(a.total_healing.total)
                    :0;
                bVal = b.total_healing?.total
                    ? Number(b.total_healing.total)
                    :0;
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
