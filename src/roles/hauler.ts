import { RoleType, RoleCount, CustomCreepMemory } from "common";

enum HaulerState {
    CHOOSING_TASK,
    TRAVELING_TO_TASK,
    COLLECTING,
    RETURNING_TO_STORAGE,
}

export class HaulerMemory implements CustomCreepMemory {
    role: RoleType;
    custom_memory: HaulerMemoryFields;

    constructor() {
        this.role = RoleType.HAULER;
        this.custom_memory = new HaulerMemoryFields();
    }
}

// A hauler can pick up a dropped resource, or a resource from a structure or another creep.
// A hauler can drop off at a position within a room, or deposit in a structure or another creep.
enum HaulerTaskType {
    DROPPED_RESOURCE,
    MINER_CREEP,
    STRUCTURE,
}

/**
 * A HaulerTask is a task that is currently assigned to a hauler. This object must be memory serializable, and must be
 * built in a way that generateHaulerTasks() will not result in duplicate tasks.
 */
class HaulerTask {
    task_type: HaulerTaskType
    source: RoomPosition;

    // Only set if task_type === HaulerTaskType.MINER_CREEP
    source_creep_name: string | null;

    prioritized_targets: RoomPosition[];

    constructor(source: RoomPosition, prioritized_targets: RoomPosition[], task_type: HaulerTaskType, source_creep_name: string | null = null) {
        this.source = source;
        this.prioritized_targets = prioritized_targets;
        this.task_type = task_type;
        this.source_creep_name = source_creep_name;
    }
}

export class HaulerMemoryFields {
    state: HaulerState;
    current_task: HaulerTask | null;

    constructor() {
        this.state = HaulerState.CHOOSING_TASK;
        this.current_task = null;
    }
}

// Creates all tasks for haulers to choose from.
// TODO: Destinations should include containers (prioritized of course).
// TODO: Create tasks to fill up extensions and spawn from containers
export function generateHaulerTasks(rooms: Room[], primary_room: Room): HaulerTask[] {
    let all_tasks: HaulerTask[] = [];
    let primary_room_spawn: StructureSpawn = Game.spawns[primary_room.find(FIND_MY_SPAWNS)[0].name];

    for (let room of rooms) {
        let dropped_resources = room.find(FIND_DROPPED_RESOURCES);

        for (let dropped_resource of dropped_resources) {
            all_tasks.push(new HaulerTask(
                new RoomPosition(dropped_resource.pos.x, dropped_resource.pos.y, room.name),
                [primary_room_spawn.pos],
                HaulerTaskType.DROPPED_RESOURCE
            ));
        }
    }

    for (let creep_name in Game.creeps) {
        let creep = Game.creeps[creep_name];
        let creep_memory = creep.memory as CustomCreepMemory;

        if (creep_memory.role === RoleType.MINER) {
            if (creep.store.getCapacity(RESOURCE_ENERGY) > 0) {
                all_tasks.push(new HaulerTask(
                    creep.pos, [primary_room_spawn.pos], HaulerTaskType.MINER_CREEP, creep.name
                ));
            }
        }
    }

    return all_tasks;
}

// Gets the RoomPosition of a task.
// function getTaskPosition(task: HaulerTask): RoomPosition {
//     if (task.source instanceof ResourceLocation) {
//         return task.source.pos_in_room;
//     } else if (task.source instanceof Structure || task.source instanceof Creep) {
//         return task.source.pos;
//     } else {
//         console.log(`getTaskPosition encountered unknown task type ${typeof task.source}!`);
//         return RoomPosition(-1, -1, "error");
//     }
// }

const TASK_TOO_FAR = 1e10;
function distanceToTask(creep: Creep, task: HaulerTask): number {
    if (task.source.roomName !== creep.room.name) {
        console.log("Implement cross-room task distances!");
        return TASK_TOO_FAR;
    }

    return creep.pos.getRangeTo(task.source.x, task.source.y);
}

// Higher return value -> Better task. Super simple for now, needs optimization.
// TODO: More energy -> Higher priority
// TODO: For DroppedResource, the amount of energy depends on how long it'll take the creep to get there.
function haulerTaskValue(creep: Creep, task: HaulerTask): number {
    return 1.0 / distanceToTask(creep, task);
}

export function runHauler(creep: Creep, role_count: RoleCount, valid_tasks: HaulerTask[]): HaulerTask[] {
    let hauler_memory = creep.memory as HaulerMemory;
    let memory = hauler_memory.custom_memory;

    console.log(`[${creep.name}] ${HaulerState[memory.state]}`);
    switch (memory.state) {
        case HaulerState.CHOOSING_TASK: {
            return chooseTask(creep, memory, valid_tasks);
        }
        case HaulerState.TRAVELING_TO_TASK: {
            return travelToTask(creep, memory, valid_tasks);
        }
        case HaulerState.COLLECTING: {
            return collect(creep, memory, valid_tasks);
        }
        case HaulerState.RETURNING_TO_STORAGE: {
            return returnToStorage(creep, memory, valid_tasks);
        }
        default: {
            console.log(`[${creep.name}] Reached unknown state ${memory.state}.`);
            return valid_tasks;
        }
    }
}

// ----- STATE METHODS -----
function chooseTask(creep: Creep, memory: HaulerMemoryFields, valid_tasks: HaulerTask[]): HaulerTask[] {
    // Precondition: No set task
    if (memory.current_task !== null) {
        console.log(" CHOOSING_TASK -> TRAVELING_TO_TASK");
        memory.state = HaulerState.TRAVELING_TO_TASK;
        return valid_tasks;
    }
    // Precondition: Available task
    if (valid_tasks.length === 0) {
        console.log(" No valid tasks remaining!");
        return [];
    }

    valid_tasks.sort((a, b) => haulerTaskValue(creep, b) - haulerTaskValue(creep, a))[0];

    let chosen_task = valid_tasks.shift();
    if (chosen_task === undefined) {
        console.log(" ERR ERR chosen_task was somehow undefined :(");
        return valid_tasks;
    }

    memory.current_task = chosen_task;
    memory.state = HaulerState.TRAVELING_TO_TASK;
    console.log(" CHOOSING_TASK -> TRAVELING_TO_TASK");

    return valid_tasks;
}

const MOVE_TO_SOURCE_STROKE = "#00ff00";
function travelToTask(creep: Creep, memory: HaulerMemoryFields, valid_tasks: HaulerTask[]): HaulerTask[] {
    // Precondition: Task is set
    if (memory.current_task === null) {
        console.log(" No task set!");
        console.log(" TRAVELING_TO_TASK -> CHOOSING_TASK");
        memory.state = HaulerState.CHOOSING_TASK;
        return valid_tasks;
    }

    // If this is a miner creep, update it's position in case it moved.
    if (memory.current_task.task_type == HaulerTaskType.MINER_CREEP) {
        if (memory.current_task.source_creep_name === null) {
            console.log(" Current task is of type MINER_CREEP, but no creep name set!");
            console.log(" TRAVELING_TO_TASK -> CHOOSING_TASK");

            memory.state = HaulerState.CHOOSING_TASK;
            memory.current_task = null;

            return valid_tasks;
        }
        memory.current_task.source = Game.creeps[memory.current_task.source_creep_name].pos;
    }

    let distance_to_task = distanceToTask(creep, memory.current_task);

    // Precondition: We can route to the task
    if (distance_to_task === TASK_TOO_FAR) {
        console.log(" Task is too far away! Choosing new task.");
        console.log(" TRAVELING_TO_TASK -> CHOOSING_TASK");
        memory.current_task = null;
        memory.state = HaulerState.CHOOSING_TASK;

        return valid_tasks;
    }

    console.log(` Task type ${HaulerTaskType[memory.current_task.task_type]} distance: ${distance_to_task}.`);

    // Move to the task if we're not close enough. Otherwise, swap to collecting.
    if (distance_to_task > 1) {
        let can_move = creep.moveTo(
            memory.current_task.source.x,
            memory.current_task.source.y,
            {visualizePathStyle: {stroke: MOVE_TO_SOURCE_STROKE}}
        );

        // If the creep can move where it wants to, and we're 2 away, swap to COLLECTING early to save a tick.
        if (can_move === OK && distance_to_task === 2) {
            console.log(" Will be close enough to task on next tick.");
            console.log(" TRAVELING_TO_TASK -> COLLECTING");

            memory.state = HaulerState.COLLECTING;
        }
    } else {
        console.log(" At task, why didn't we catch this above?");
        console.log(" TRAVELING_TO_TASK -> COLLECTING");
        memory.state = HaulerState.COLLECTING;
    }

    return valid_tasks;
}

function collect(creep: Creep, memory: HaulerMemoryFields, valid_tasks: HaulerTask[]): HaulerTask[] {
    // Precondition: Creep has space to pickup more
    if (creep.store.getFreeCapacity() === 0) {
        console.log(" Creep full!");
        console.log(" COLLECTING -> RETURNING_TO_STORAGE");

        memory.state = HaulerState.RETURNING_TO_STORAGE;
        return valid_tasks;
    }
    // Precondition: Has task
    if (memory.current_task === null) {
        console.log(" Collecting, but no task set!");
        console.log(" COLLECTING -> CHOOSING_TASK");

        memory.state = HaulerState.CHOOSING_TASK;
        return valid_tasks;
    }
    // Precondition: Close enough to pickup
    let distance_to_task = distanceToTask(creep, memory.current_task);
    if (distance_to_task > 1) {
        console.log(" Trying to collect, but too far away!");
        console.log(" COLLECTING -> TRAVELING_TO_TASK");

        memory.state = HaulerState.TRAVELING_TO_TASK;
        return valid_tasks;
    }

    if (memory.current_task.task_type === HaulerTaskType.MINER_CREEP) {
        let source_creep_name = memory.current_task.source_creep_name;
        if (source_creep_name === null) {
            console.log(" Trying to pickup energy from a miner creep, but the task doesn't have a source creep name set!");
            console.log(" COLLECTING -> CHOOSING_TASK");

            memory.current_task = null;
            memory.state = HaulerState.CHOOSING_TASK;

            return valid_tasks;
        }

        // Transfer from miner creep to this hauler
        let successful_transfer = Game.creeps[source_creep_name].transfer(creep, RESOURCE_ENERGY);
        if (successful_transfer !== OK) {
            console.log(` Unsuccessful miner creep transfer: ${successful_transfer}.`);
        }
    } else if (memory.current_task.task_type == HaulerTaskType.DROPPED_RESOURCE) {
        let dropped_resource = droppedResourceFromPosition(memory.current_task.source);
        if (dropped_resource === null) {
            console.log(" Trying to collect, but couldn't find dropped resource.");
            console.log(" COLLECTING -> CHOOSING_TASK");

            memory.current_task = null;
            memory.state = HaulerState.CHOOSING_TASK;

            return valid_tasks;
        }

        let successful_pickup = creep.pickup(dropped_resource);
        if (successful_pickup !== OK) {
            console.log(` Unsuccessful dropped resource pickup: ${successful_pickup}.`);
            console.log(" COLLECTING -> CHOOSING_TASK");

            memory.current_task = null;
            memory.state = HaulerState.CHOOSING_TASK;
        }
    } else if (memory.current_task.task_type == HaulerTaskType.STRUCTURE) {
        console.log(" Implement pickups from structure!");
        return valid_tasks;
    } else {
        console.log(" Collecting, but no task type set!");
        console.log(" COLLECTING -> CHOOSING_TASK");

        memory.current_task = null;
        memory.state = HaulerState.CHOOSING_TASK;
        return valid_tasks;
    }

    return valid_tasks;
}

const MOVE_TO_TARGET_STROKE = "#0000ff";
function returnToStorage(creep: Creep, memory: HaulerMemoryFields, valid_tasks: HaulerTask[]): HaulerTask[] {
    // Precondition: Have task
    if (memory.current_task === null) {
        console.log(" Trying to return to storage, but no task set!");
        console.log(" RETURNING_TO_STORAGE -> CHOOSING_TASK");

        memory.state = HaulerState.CHOOSING_TASK;
        return valid_tasks;
    }
    // Precondition: Have resources to drop off
    if (creep.store.getUsedCapacity() === 0) {
        console.log(" Trying to return to storage, but nothing to return!");
        console.log(" RETURNING_TO_STORAGE -> CHOOSING_TASK");

        memory.state = HaulerState.CHOOSING_TASK;
        return valid_tasks;
    }
    // Precondition: There is a target
    if (memory.current_task.prioritized_targets.length === 0) {
        console.log(" Trying to return to storage, but there are no targets!");
        console.log(" RETURNING_TO_STORAGE -> CHOOSING_TASK");

        memory.state = HaulerState.CHOOSING_TASK;
        return valid_tasks;
    }

    // TODO: Actually iterate through prioritized dropoffs
    let target = memory.current_task.prioritized_targets[0];

    // Precondition: Target is in the same room
    if (target.roomName !== creep.room.name) {
        console.log(" Implement cross-room pathing!");
    }

    let distance_to_target = creep.pos.getRangeTo(target.x, target.y);
    if (distance_to_target > 1) {
        creep.moveTo(target.x, target.y, {visualizePathStyle: {stroke: MOVE_TO_TARGET_STROKE}});
    } else {
        let structure = structureAtPosition(target);
        if (structure === null) {
            console.log(" Trying to return to structure, but it wasn't found!");
            console.log(" RETURNING_TO_STORAGE -> CHOOSING_TASK");

            memory.state = HaulerState.CHOOSING_TASK;
            return valid_tasks;
        }

        let successful_transfer = creep.transfer(structure, RESOURCE_ENERGY);
        if (successful_transfer !== OK) {
            console.log(` Can't transfer to structure: ${successful_transfer}.`);
        }
    }

    return valid_tasks;
}
// -------------------------

// State method helpers
function droppedResourceFromPosition(pos: RoomPosition): Resource<ResourceConstant> | null {
    let dropped_resources = Game.rooms[pos.roomName].find(FIND_DROPPED_RESOURCES, {filter: {pos: pos}});

    if (dropped_resources.length === 0) {
        console.log(`No dropped resources found at (${pos.x}, ${pos.y}, ${pos.roomName}).`);
        return null;
    }

    return dropped_resources[0];
}

function structureAtPosition(pos: RoomPosition): Structure<STRUCTURE_CONTAINER | STRUCTURE_SPAWN> | null {
    let structures_at_position = Game.rooms[pos.roomName].find(FIND_STRUCTURES, {
        filter: (structure) => structure.structureType == STRUCTURE_SPAWN || structure.structureType == STRUCTURE_CONTAINER
    }) as StructureSpawn[] | StructureContainer[];

    if (structures_at_position.length === 0) {
        console.log(`No spawns or containers found at (${pos.x}, ${pos.y}, ${pos.roomName}).`);
        return null;
    }

    return structures_at_position[0];
}
