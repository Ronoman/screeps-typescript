import { RoleType, CustomCreepMemory, nextToRoomObject } from "common";

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

export class Miner {
    creep: Creep;
    memory: MinerMemoryFields;
    target_source: Source;

    constructor(creep: Creep) {
        this.creep = creep;
        this.memory = (creep.memory as MinerMemory).custom_memory;

        let target_source = Game.getObjectById(this.memory.source_id);
        if (target_source === null) {
            this.creep.say("Bad Source");
            return;
        }

        this.target_source = target_source;
    }

    run(hauler_count: number) {
        console.log(`[${this.creep.name}] (${MinerState[this.memory.state]})`);
        switch (this.memory.state) {
            // The miner needs to return to it's source to begin harvesting resources again.
            case MinerState.TRAVELING_TO_SOURCE: {
                this.travelToSource();
                return;
            }

            // The miner is at it's source. Harvest!
            case MinerState.HARVESTING: {
                this.harvest(hauler_count);
                return;
            }

            // The miner is full on resources, and there are no haulers available to pick up it's energy.
            case MinerState.RETURNING_ENERGY: {
                this.returnEnergy();
                return;
            }
            default: {
                console.log(` Invalid state ${this.memory.state}`)
                return;
            }
        }
    }

    travelToSource() {
        if (nextToRoomObject(this.creep, this.target_source)) {
            console.log(" TRAVELING_TO_SOURCE -> HARVESTING");
            this.memory.state = MinerState.HARVESTING;
            return;
        } else {
            this.creep.moveTo(this.target_source.pos.x, this.target_source.pos.y, {visualizePathStyle: {stroke: TRAVELING_TO_SOURCE_STROKE}});
        }

        return;
    }

    harvest(hauler_count: number) {
        // Precondition: Next to source. If not, transition to traveling.
        if (!nextToRoomObject(this.creep, this.target_source)) {
            console.log(` Not next to source! Dist: ${this.target_source.pos.getRangeTo(this.creep.pos.x, this.creep.pos.y)}`);
            console.log(" HARVESTING -> TRAVELING_TO_SOURCE");
            this.memory.state = MinerState.TRAVELING_TO_SOURCE;
            return;
        }

        // Main action: Harvest
        let harvest_success = this.creep.harvest(this.target_source);
        if (harvest_success !== OK) {
            console.log(`  Can't harvest! Error: ${harvest_success}.`)
            return;
        }

        // Possible transition: If there are no haulers and this creep is full, return the energy.
        // console.log(` Free capacity: ${creep.store.getFreeCapacity()}. Role counts: ${role_count}`);
        if (this.creep.store.getFreeCapacity() == 0 && hauler_count == 0) {
            console.log(" HARVESTING -> RETURNING_ENERGY");
            this.memory.state = MinerState.RETURNING_ENERGY;
            return;
        }

        return;
    }

    returnEnergy() {
        // Precondition: Creep has energy
        if (this.creep.store.getFreeCapacity() === this.creep.store.getCapacity()) {
            console.log(" RETURNING_ENERGY -> TRAVELING_TO_SOURCE");
            this.memory.state = MinerState.TRAVELING_TO_SOURCE;
            return;
        }

        // Main action: Return energy to spawn
        let spawns_in_room = this.creep.room.find(
            FIND_STRUCTURES,
            { filter: (structure) => { return structure.structureType == STRUCTURE_SPAWN }}
        ) as StructureSpawn[];

        if (spawns_in_room.length === 0) {
            console.log("No spawns in room!!!")
            return;
        }

        let spawn_in_room = spawns_in_room[0];

        if (!nextToRoomObject(this.creep, spawn_in_room)) {
            this.creep.moveTo(spawn_in_room.pos.x, spawn_in_room.pos.y, {visualizePathStyle: {stroke: TRAVELING_TO_SPAWN_STROKE}});
        } else {
            let successful_transfer = this.creep.transfer(spawn_in_room, RESOURCE_ENERGY);
            if (successful_transfer !== OK) {
                console.log(` Can't transfer! Error: ${successful_transfer}.`);
                this.creep.drop(RESOURCE_ENERGY);
            }
        }

        return;
    }
}
