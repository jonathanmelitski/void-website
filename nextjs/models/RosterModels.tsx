export type Player = {
    id: string,
    first_name: string,
    last_name: string,
    number: number,
    team: Team,
    is_captain: boolean,
    jersey_name_text?: string,
    is_active: boolean
}

export enum Team {
    void = "VOID",
    null = "NULL"
}