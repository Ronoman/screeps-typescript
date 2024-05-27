export enum RoleType {
    MINER,
    HAULER,
    BUILDER,
}

// TODO: There's gotta be a better way.
export class RoleCount {
    harvesters: number;
    haulers: number;
    builders: number;

    constructor(harvesters: number, haulers: number, builders: number) {
        this.harvesters = harvesters;
        this.haulers = haulers;
        this.builders = builders;
    }
}

export function nextToRoomObject(creep: Creep, room_object: RoomObject): boolean {
    return room_object.pos.getRangeTo(creep.pos.x, creep.pos.y) == 1;
}

export interface CustomCreepMemory {
    role: RoleType;
    custom_memory: any;
}
