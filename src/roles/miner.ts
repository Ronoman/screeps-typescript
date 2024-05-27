import { RoleType, RoleCount, CustomCreepMemory, nextToRoomObject } from "common";

enum MinerState {
    TRAVELING_TO_SOURCE,
    HARVESTING,
    RETURNING_ENERGY,
}

export class MinerMemory implements CustomCreepMemory {
    role: RoleType;
    custom_memory: MinerMemoryFields;

    constructor(source_id: Id<Source>) {
        this.role = RoleType.MINER;
        this.custom_memory = new MinerMemoryFields(source_id);
    }
}

export class MinerMemoryFields {
    state: MinerState;
    source_id: Id<Source>;

    constructor(source_id: Id<Source>) {
        this.source_id = source_id;
        this.state = MinerState.TRAVELING_TO_SOURCE;
    }
}

const TRAVELING_TO_SOURCE_STROKE = "#ffffff";
const TRAVELING_TO_SPAWN_STROKE = "#ffaa00";

export function runMiner(creep: Creep, role_count: RoleCount) {
    let miner_memory = creep.memory as MinerMemory;
    let memory = miner_memory.custom_memory;

    let target_source = Game.getObjectById(memory.source_id);
    if (target_source === null) {
        creep.say("Bad Source");
        return;
    }

    console.log(`[${creep.name}] (${MinerState[memory.state]})`);
    switch (memory.state) {
        // The miner needs to return to it's source to begin harvesting resources again.
        case MinerState.TRAVELING_TO_SOURCE: {
            if (nextToRoomObject(creep, target_source)) {
                console.log(" TRAVELING_TO_SOURCE -> HARVESTING");
                memory.state = MinerState.HARVESTING;
                return;
            } else {
                creep.moveTo(target_source.pos.x, target_source.pos.y, {visualizePathStyle: {stroke: TRAVELING_TO_SOURCE_STROKE}});
            }

            return;
        }

        // The miner is at it's source. Harvest!
        case MinerState.HARVESTING: {
            // Precondition: Next to source. If not, transition to traveling.
            if (!nextToRoomObject(creep, target_source)) {
                console.log(` Not next to source! Dist: ${target_source.pos.getRangeTo(creep.pos.x, creep.pos.y)}`);
                console.log(" HARVESTING -> TRAVELING_TO_SOURCE");
                memory.state = MinerState.TRAVELING_TO_SOURCE;
                return;
            }

            // Main action: Harvest
            let harvest_success = creep.harvest(target_source);
            if (harvest_success !== OK) {
                console.log(`  Can't harvest! Error: ${harvest_success}.`)
                return;
            }

            // Possible transition: If there are no haulers and this creep is full, return the energy.
            // console.log(` Free capacity: ${creep.store.getFreeCapacity()}. Role counts: ${role_count}`);
            if (creep.store.getFreeCapacity() == 0 && role_count.haulers == 0) {
                console.log(" HARVESTING -> RETURNING_ENERGY");
                memory.state = MinerState.RETURNING_ENERGY;
                return;
            }

            return;
        }

        // The miner is full on resources, and there are no haulers available to pick up it's energy.
        case MinerState.RETURNING_ENERGY: {
            // Precondition: Creep has energy
            if (creep.store.getFreeCapacity() === creep.store.getCapacity()) {
                console.log(" RETURNING_ENERGY -> TRAVELING_TO_SOURCE");
                memory.state = MinerState.TRAVELING_TO_SOURCE;
                return;
            }

            // Main action: Return energy to spawn
            let spawns_in_room = creep.room.find(
                FIND_STRUCTURES,
                { filter: (structure) => { return structure.structureType == STRUCTURE_SPAWN }}
            ) as StructureSpawn[];

            if (spawns_in_room.length === 0) {
                console.log("No spawns in room!!!")
                return;
            }

            let spawn_in_room = spawns_in_room[0];

            if (!nextToRoomObject(creep, spawn_in_room)) {
                creep.moveTo(spawn_in_room.pos.x, spawn_in_room.pos.y, {visualizePathStyle: {stroke: TRAVELING_TO_SPAWN_STROKE}});
            } else {
                let successful_transfer = creep.transfer(spawn_in_room, RESOURCE_ENERGY);
                if (successful_transfer !== OK) {
                    console.log(` Can't transfer! Error: ${successful_transfer}.`);
                    creep.drop(RESOURCE_ENERGY);
                }
            }

            return;
        }
        default: {
            return;
        }
    }
}
