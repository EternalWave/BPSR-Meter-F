/**
 * Type definitions for the BPSR Meter renderer process
 */

// API Response types
export interface ApiResponse<T = any> {
    code: number;
    data?: T;
    msg?: string;
}

// Translation types
export interface Translations {
    skills?: Record<string, string>;
    professions?: Record<string, string>;
    ui?: Record<string, any>;
    [key: string]: any;
}

// Player data types
export interface PlayerData {
    name: string;
    profession: string;
    currentHp: number;
    maxHp: number;
    totalDmg: number;
    totalDmgTaken: number;
    totalHeal: number;
    totalShield: number;
    realtimeDps: number;
    percentDmg: number;
    percentDmgTaken: number;
    percentHeal: number;
    critRate: number;
    uuid?: string;
    id?: string;
    skills?: SkillData[];
}

// Skill data types
export interface SkillData {
    skillId: number;
    skillName: string;
    totalDmg: number;
    hitCount: number;
    critCount: number;
    critRate: number;
    avgDmg: number;
    percentDmg: number;
}

// Profession data types
export interface ProfessionInfo {
    name: string;
    icon: string;
    role: "dps" | "tank" | "healer";
}

export type ProfessionMap = Record<string, ProfessionInfo>;

// Settings types
export interface Settings {
    language?: string;
    autoClearOnServerChange?: boolean;
    autoClearOnTimeout?: boolean;
    onlyRecordEliteDummy?: boolean;
    [key: string]: any;
}

// Manual group types
export interface ManualGroupState {
    enabled: boolean;
    members: string[];
}

// Player registry types
export interface PlayerRegistry {
    [uuid: string]: {
        name: string;
        lastSeen?: number;
    };
}

// UI state types
export type ViewMode = "nearby" | "solo" | "skills";
export type SortColumn =
    | "totalDmg"
    | "totalDmgTaken"
    | "totalHeal"
    | "realtimeDps";
export type SortDirection = "asc" | "desc";

// Skill modal types
export interface SkillModalData {
    playerName: string;
    skills: SkillData[];
}
