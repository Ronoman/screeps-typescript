export enum RoleType {
    MINER,
    HAULER,
    UPGRADER,
    BUILDER,
}

export function nextToRoomObject(creep: Creep, room_object: RoomObject): boolean {
    return room_object.pos.getRangeTo(creep.pos.x, creep.pos.y) == 1;
}

export interface CustomCreepMemory {
    role: RoleType;
    custom_memory: any;
}
