import { RoleType, CustomCreepMemory } from "common";
import { drop, pick } from "lodash";

export class HaulerMemory implements CustomCreepMemory {
    role: RoleType;
    custom_memory: HaulerMemoryFields;

    constructor() {
        this.role = RoleType.HAULER;
        this.custom_memory = new HaulerMemoryFields();
    }
}

export class HaulerMemoryFields {
    state: HaulerState;
    current_task: HaulerTask | null;

    constructor() {
        this.state = HaulerState.WAITING_FOR_PICKUP_TASK;
        this.current_task = null;
    }
}

const TOO_FAR = 1e10;
export class Hauler {
    creep: Creep;
    memory: HaulerMemoryFields;
    state_machine: HaulerStateMachine;

    constructor(creep: Creep) {
        this.creep = creep;
        this.memory = (creep.memory as HaulerMemory).custom_memory;

        this.state_machine = new HaulerStateMachine(creep, this.memory);
    }

    run() {
        this.state_machine.run();
    }

    growAndReturnTask(): HaulerTask | null {
        let current_task = this.memory.current_task;
        if (current_task !== null) {
            console.log(`[${this.creep.name}] Growing task`);

            if (current_task.task_type === HaulerPickupType.DROPPED_RESOURCE) {
                return this.growDroppedTask(current_task);
            } else if (current_task.task_type == HaulerPickupType.CREEP || current_task.task_type == HaulerDropoffType.CREEP) {
                return this.growCreepTask(current_task);
            } else if (current_task.task_type == HaulerPickupType.STRUCTURE || current_task.task_type == HaulerDropoffType.STRUCTURE) {
                return this.growStructureTask(current_task);
            } else {
                console.log(`Invalid task type: ${current_task.task_type}`);
            }

            return null;
        } else {
            console.log(`[${this.creep.name}] No task to grow`);
            return null;
        }
    }

    growDroppedTask(current_task: HaulerTask): HaulerTask {
        // Find the dropped resource we're going after
        // TODO[optimize]: Find resources once per tick, instead of once per hauler.
        let dropped_resources = Game.rooms[current_task.position.roomName].find(FIND_DROPPED_RESOURCES);

        let current_task_resource: Resource<RESOURCE_ENERGY> | null = null;
        for (let dropped_resource of dropped_resources) {
            if (_.isEqual(dropped_resource.pos, current_task.position) && dropped_resource.resourceType == RESOURCE_ENERGY) {
                current_task_resource = (dropped_resource as Resource<RESOURCE_ENERGY>);
            }
        }

        if (current_task_resource === null) {
            console.log(`[${this.creep.name}] Can't find resource pile to grow dropped resource task.`);
            return current_task;
        }

        // If the dropped resource pile has grown, increase current task's resource amount
        current_task.resource_amount = Math.min(current_task_resource.amount, this.creep.store.getFreeCapacity());

        return current_task;
    }

    growCreepTask(current_task: HaulerTask): HaulerTask {
        if (current_task.creep_name === null) {
            console.log(`[${this.creep.name}] Can't find creep_name to grow creep task.`);
            return current_task;
        }

        // Find the current task's creep
        let current_task_creep = Game.creeps[current_task.creep_name];

        // Grow the task.
        // If we're picking up, we want to get the target creep's used capacity.
        // If we're dropping off, we want to get the target creep's free capacity.
        if (this.memory.state == HaulerState.PICKING_UP) {
            current_task.resource_amount = Math.min(
                current_task_creep.store.getUsedCapacity(current_task.resource_type),
                this.creep.store.getFreeCapacity()
            );
        } else {
            current_task.resource_amount = Math.min(
                current_task_creep.store.getFreeCapacity(),
                this.creep.store.getUsedCapacity(current_task.resource_type)
            );
        }

        // Update task location regardless to ensure a match later
        current_task.position = current_task_creep.pos;

        return current_task;
    }

    growStructureTask(current_task: HaulerTask): HaulerTask {
        // Find the structure we're targeting
        // TODO[optimize]: Find task structures once and put them in a map, instead of once per hauler.
        let structures_in_task_room = Game.rooms[current_task.position.roomName].find(FIND_STRUCTURES, { filter: (structure) => _.isEqual(structure.pos, current_task.position) });

        if (structures_in_task_room.length != 1) {
            console.log(`[${this.creep.name}] Can't find structure when growing structure task.`);
        }

        let current_task_structure = structures_in_task_room[0] as StructureContainer;

        // Grow the task
        if (this.memory.state === HaulerState.TRAVELING_TO_PICKUP || this.memory.state === HaulerState.PICKING_UP) {
            current_task.resource_amount = Math.min(
                current_task_structure.store.getUsedCapacity(current_task.resource_type),
                this.creep.store.getFreeCapacity()
            );
        } else if (this.memory.state === HaulerState.TRAVELING_TO_DROPOFF || this.memory.state === HaulerState.DROPPING_OFF) {
            current_task.resource_amount = Math.min(
                current_task_structure.store.getFreeCapacity(),
                this.creep.store.getUsedCapacity(RESOURCE_ENERGY)
            );
        }

        return current_task;
    }

    distanceToTask(task: HaulerTask): number {
        if (this.creep.room.name !== task.position.roomName) {
            // TODO[multiroom]
            return TOO_FAR;
        }

        return task.position.getRangeTo(this.creep.pos.x, this.creep.pos.y);
    }

    valuePickupTask(task: HaulerTask): number {
        const DISTANCE_SCALAR = 10;
        return (task.resource_amount) / (DISTANCE_SCALAR * this.distanceToTask(task));
    }

    choosePickupTask(available_tasks: HaulerTask[]): HaulerTask[] {
        console.log(`[${this.creep.name}] Choosing pickup task`);
        if (this.memory.state !== HaulerState.WAITING_FOR_PICKUP_TASK) {
            console.log(`[${this.creep.name}] Asked to choose a pickup task, but not waiting for one!`);
            return available_tasks;
        }

        if (this.memory.current_task !== null) {
            console.log(`[${this.creep.name}] Asked to choose a pickup task, but already have a pickup task!`);
        }

        available_tasks.sort((a, b) => this.valuePickupTask(b) - this.valuePickupTask(a));

        let chosen_task = available_tasks.shift();
        if (chosen_task === undefined) {
            console.log(`[${this.creep.name}] Unable to find pickup task to choose.`);
            return available_tasks;
        }

        this.memory.current_task = chosen_task;
        console.log(`[${this.creep.name}] Chose task: ${HaulerPickupType[chosen_task.task_type]}`)

        if (chosen_task.task_type === HaulerPickupType.CREEP) {
            console.log(`    Pickup creep name: ${chosen_task.creep_name}`);
        }
        return available_tasks;
    }

    valueDropoffTask(task: HaulerTask): number {
        const DISTANCE_SCALAR = 10;

        // TODO[improvement] consider depending on dropoff type, and further by structure type
        return (task.resource_amount) / (DISTANCE_SCALAR * this.distanceToTask(task));
    }

    chooseDropoffTask(available_tasks: HaulerTask[]): HaulerTask[] {
        // TODO[unfinished]
        if (this.memory.state !== HaulerState.WAITING_FOR_DROPOFF_TASK) {
            console.log(`[${this.creep.name}] Asked to choose a dropoff task, but not waiting for one!`);
            return available_tasks;
        }

        if (this.memory.current_task !== null) {
            console.log(`[${this.creep.name}] Asked to choose a dropoff task, but already have a dropoff task!`);
        }

        available_tasks.sort((a, b) => this.valuePickupTask(b) - this.valuePickupTask(a));

        let chosen_task = available_tasks.shift();
        if (chosen_task === undefined) {
            console.log(`[${this.creep.name}] Unable to find pickup task to choose.`);
            return available_tasks;
        }

        this.memory.current_task = chosen_task;

        return available_tasks;
    }
}

enum HaulerState {
    WAITING_FOR_PICKUP_TASK,
    TRAVELING_TO_PICKUP,
    PICKING_UP,
    WAITING_FOR_DROPOFF_TASK,
    TRAVELING_TO_DROPOFF,
    DROPPING_OFF,
}

class HaulerStateMachine {
    creep: Creep
    memory: HaulerMemoryFields

    constructor(creep: Creep, memory: HaulerMemoryFields) {
        this.creep = creep;
        this.memory = memory;
    }

    run() {
        console.log(`[${this.creep.name}] ${HaulerState[this.memory.state]}`);
        switch (this.memory.state) {
            case HaulerState.WAITING_FOR_PICKUP_TASK: {
                this.waitForPickup();
                return;
            }
            case HaulerState.TRAVELING_TO_PICKUP: {
                this.travelToPickup();
                return;
            }
            case HaulerState.PICKING_UP: {
                this.pickup();
                return;
            }
            case HaulerState.WAITING_FOR_DROPOFF_TASK: {
                this.waitForDropoff();
                return;
            }
            case HaulerState.TRAVELING_TO_DROPOFF: {
                this.travelToDropoff();
                return;
            }
            case HaulerState.DROPPING_OFF: {
                this.dropoff();
                return;
            }
            default: {
                console.log(` Reached unknown state ${this.memory.state}.`);
            }
        }
    }

    waitForPickup() {
        if (this.memory.current_task !== null) {
            console.log(` Task was assigned! Done waiting for pickup. Immediate transition.`);
            console.log(` WAITING_FOR_PICKUP_TASK -> TRAVELING_TO_PICKUP`);

            this.memory.state = HaulerState.TRAVELING_TO_PICKUP;
            this.travelToPickup();
            return;
        }

        console.log(` Waiting for task assignment.`);
        return;
    }

    travelToPickup() {
        const MOVE_TO_PICKUP_STROKE = "#00ff00";

        // Precondition: Task is set
        if (this.memory.current_task === null) {
            console.log(" No task set!");
            console.log(" TRAVELING_TO_PICKUP -> WAITING_FOR_PICKUP_TASK");
            this.memory.state = HaulerState.WAITING_FOR_PICKUP_TASK;
            return;
        }

        // If this is a miner creep, update it's position in case it moved.
        if (this.memory.current_task.task_type == HaulerPickupType.CREEP) {
            if (this.memory.current_task.creep_name === null) {
                console.log(" Current task is of type CREEP, but no creep name set!");
                console.log(" TRAVELING_TO_PICKUP -> WAITING_FOR_PICKUP_TASK");

                this.memory.state = HaulerState.WAITING_FOR_PICKUP_TASK;
                this.memory.current_task = null;

                return;
            }
            this.memory.current_task.position = Game.creeps[this.memory.current_task.creep_name].pos;
        }

        let p = this.memory.current_task.position;
        let current_task_position = new RoomPosition(p.x, p.y, p.roomName);

        let distance_to_task = current_task_position.getRangeTo(this.creep.pos.x, this.creep.pos.y);

        // Precondition: We can route to the task
        if (distance_to_task === TOO_FAR) {
            console.log(" Task is too far away! Choosing new task.");
            console.log(" TRAVELING_TO_PICKUP -> WAITING_FOR_PICKUP_TASK");
            this.memory.current_task = null;
            this.memory.state = HaulerState.WAITING_FOR_PICKUP_TASK;

            return;
        }

        console.log(` Task type ${HaulerPickupType[this.memory.current_task.task_type]} distance: ${distance_to_task}.`);

        // Move to the task if we're not close enough. Otherwise, swap to picking up.
        if (distance_to_task > 1) {
            let can_move = this.creep.moveTo(
                this.memory.current_task.position.x,
                this.memory.current_task.position.y,
                {visualizePathStyle: {stroke: MOVE_TO_PICKUP_STROKE}}
            );

            // If the creep can move where it wants to, and we're 2 away, swap to PICKING_UP early to save a tick.
            if (can_move === OK && distance_to_task === 2) {
                console.log(" Will be close enough to task on next tick.");
                console.log(" TRAVELING_TO_PICKUP -> PICKING_UP");

                this.memory.state = HaulerState.PICKING_UP;
            }
        } else {
            console.log(" At task, why didn't we catch this above?");
            console.log(" TRAVELING_TO_PICKUP -> PICKING_UP");
            this.memory.state = HaulerState.PICKING_UP;
        }

        return;
    }

    pickup() {
        // Precondition: Creep has space to pickup more
        if (this.creep.store.getFreeCapacity() === 0) {
            console.log(" Creep full!");
            console.log(" PICKING_UP -> WAITING_FOR_DROPPOFF_TASK");

            this.memory.state = HaulerState.WAITING_FOR_DROPOFF_TASK;
            return;
        }
        // Precondition: Has task
        if (this.memory.current_task === null) {
            console.log(" Collecting, but no task set!");
            console.log(" PICKING_UP -> WAITING_FOR_PICKUP_TASK");

            this.memory.state = HaulerState.WAITING_FOR_PICKUP_TASK;
            return;
        }
        // Precondition: Close enough to pickup
        let p = this.memory.current_task.position;
        let current_task_position = new RoomPosition(p.x, p.y, p.roomName);

        let distance_to_task = current_task_position.getRangeTo(this.creep.pos.x, this.creep.pos.y);
        if (distance_to_task > 1) {
            console.log(" Trying to collect, but too far away!");
            console.log(" PICKING_UP -> TRAVELING_TO_PICKUP");

            this.memory.state = HaulerState.TRAVELING_TO_PICKUP;
        }

        if (this.memory.current_task.task_type === HaulerPickupType.CREEP) {
            let source_creep_name = this.memory.current_task.creep_name;
            if (source_creep_name === null) {
                console.log(" Trying to pickup energy from a miner creep, but the task doesn't have a source creep name set!");
                console.log(" PICKING_UP -> WAITING_FOR_PICKUP_TASK");

                this.memory.current_task = null;
                this.memory.state = HaulerState.WAITING_FOR_PICKUP_TASK;

                return;
            }

            // If this creep only has one tick worth of energy, consider other pickups.
            let miner_creep = Game.creeps[source_creep_name];

            // TODO[assumption] all miners only mine energy
            if (miner_creep.getActiveBodyparts(WORK) * 2 === miner_creep.store.getUsedCapacity(RESOURCE_ENERGY)) {
                console.log(" Miner only has 1 tick worth of energy, considering other pickups.");
                console.log(" PICKING_UP -> WAITING_FOR_PICKUP_TASK");

                this.memory.current_task = null;
                this.memory.state = HaulerState.WAITING_FOR_PICKUP_TASK;

                return;
            }

            // Transfer from miner creep to this hauler
            let successful_transfer = Game.creeps[source_creep_name].transfer(this.creep, RESOURCE_ENERGY);
            if (successful_transfer !== OK) {
                console.log(` Unsuccessful miner creep transfer: ${successful_transfer}.`);
                console.log(" PICKING_UP -> WAITING_FOR_PICKUP_TASK");

                this.memory.state = HaulerState.WAITING_FOR_PICKUP_TASK;
                this.memory.current_task = null;

                return;
            }
        } else if (this.memory.current_task.task_type == HaulerPickupType.DROPPED_RESOURCE) {
            console.log(" Is dropped resource");
            let dropped_resource = droppedResourceFromPosition(this.memory.current_task.position);
            if (dropped_resource === null) {
                console.log(" Trying to collect, but couldn't find dropped resource.");
                console.log(" PICKING_UP -> WAITING_FOR_PICKUP_TASK");

                this.memory.current_task = null;
                this.memory.state = HaulerState.WAITING_FOR_PICKUP_TASK;

                return;
            }

            let successful_pickup = this.creep.pickup(dropped_resource);
            if (successful_pickup !== OK) {
                console.log(` Unsuccessful dropped resource pickup: ${successful_pickup}.`);
                console.log(" PICKING_UP -> WAITING_FOR_PICKUP_TASK");

                this.memory.current_task = null;
                this.memory.state = HaulerState.WAITING_FOR_PICKUP_TASK;
            }
        } else if (this.memory.current_task.task_type == HaulerPickupType.STRUCTURE) {
            // TODO[unfinished] implement pickups from structure
            console.log(" Implement pickups from structure!");
            return;
        } else {
            console.log(" Collecting, but no task type set!");
            console.log(" PICKING_UP -> WAITING_FOR_PICKUP_TASK");

            this.memory.current_task = null;
            this.memory.state = HaulerState.WAITING_FOR_PICKUP_TASK;
            return;
        }

        return;
    }

    waitForDropoff() {
        if (this.memory.current_task !== null) {
            console.log(` Task was assigned! Done waiting for pickup. Immediate transition.`);
            console.log(` WAITING_FOR_DROPOFF_TASK -> TRAVELING_TO_DROPOFF`);

            this.memory.state = HaulerState.TRAVELING_TO_DROPOFF;
            this.travelToDropoff();
            return;
        }

        console.log(` Waiting for task assignment.`);
        return;
    }

    travelToDropoff() {
        // TODO[refactor]: Deduplicate from travelToPickup logic

        const MOVE_TO_DROPOFF_STROKE = "#0000ff";

        // Precondition: Task is set
        if (this.memory.current_task === null) {
            console.log(" No task set!");
            console.log(" TRAVELING_TO_DROPOFF -> WAITING_FOR_DROPOFF_TASK");
            this.memory.state = HaulerState.WAITING_FOR_DROPOFF_TASK;
            return;
        }

        // Precondition: Has resources to deposit
        if (this.creep.store.getUsedCapacity(this.memory.current_task.resource_type) === 0) {
            console.log(" No resources to drop off!");
            console.log(" TRAVEL_TO_DROPOFF -> WAITING_FOR_PICKUP_TASK");

            this.memory.state = HaulerState.WAITING_FOR_PICKUP_TASK;
            return;
        }

        // If this is a miner creep, update it's position in case it moved.
        if (this.memory.current_task.task_type == HaulerDropoffType.CREEP) {
            if (this.memory.current_task.creep_name === null) {
                console.log(" Current task is of type CREEP, but no creep name set!");
                console.log(" TRAVELING_TO_DROPOFF -> WAITING_FOR_DROPOFF_TASK");

                this.memory.state = HaulerState.WAITING_FOR_DROPOFF_TASK;
                this.memory.current_task = null;

                return;
            }
            this.memory.current_task.position = Game.creeps[this.memory.current_task.creep_name].pos;
        }

        let p = this.memory.current_task.position;
        let current_task_position = new RoomPosition(p.x, p.y, p.roomName);

        let distance_to_task = current_task_position.getRangeTo(this.creep.pos.x, this.creep.pos.y);

        // Precondition: We can route to the task
        if (distance_to_task === TOO_FAR) {
            console.log(" Task is too far away! Choosing new task.");
            console.log(" TRAVELING_TO_DROPOFF -> WAITING_FOR_DROPOFF_TASK");
            this.memory.current_task = null;
            this.memory.state = HaulerState.WAITING_FOR_DROPOFF_TASK;

            return;
        }

        console.log(` Task type ${HaulerPickupType[this.memory.current_task.task_type]} distance: ${distance_to_task}.`);

        // Move to the task if we're not close enough. Otherwise, swap to picking up.
        if (distance_to_task > 1) {
            let can_move = this.creep.moveTo(
                this.memory.current_task.position.x,
                this.memory.current_task.position.y,
                {visualizePathStyle: {stroke: MOVE_TO_DROPOFF_STROKE}}
            );

            // If the creep can move where it wants to, and we're 2 away, swap to PICKING_UP early to save a tick.
            if (can_move === OK && distance_to_task === 2) {
                console.log(" Will be close enough to task on next tick.");
                console.log(" TRAVELING_TO_DROPOFF -> DROPPING_OFF");

                this.memory.state = HaulerState.DROPPING_OFF;
            }
        } else {
            console.log(" At task, why didn't we catch this above?");
            console.log(" TRAVELING_TO_DROPOFF -> DROPPING_OFF");
            this.memory.state = HaulerState.DROPPING_OFF;
        }

        return;
    }

    dropoff() {
        if (this.memory.current_task === null) {
            console.log(" In dropoff, but no task set!");
            console.log(" DROPPING_OFF -> WAITING_FOR_DROPOFF_TASK");

            this.memory.state = HaulerState.WAITING_FOR_DROPOFF_TASK;
            return;
        }

        // Precondition: Has resources to drop off
        if (this.creep.store.getUsedCapacity(this.memory.current_task.resource_type) === 0) {
            console.log(" No resources left to drop off.");
            console.log(" DROPPING_OFF -> WAITING_FOR_PICKUP_TASK");

            this.memory.state = HaulerState.WAITING_FOR_DROPOFF_TASK;
            this.memory.current_task = null;

            return;
        }

        // Precondition: Target is in the same room
        let target = this.memory.current_task.position;
        if (target.roomName !== this.creep.room.name) {
            console.log(" Implement cross-room pathing!");
        }

        let distance_to_target = this.creep.pos.getRangeTo(target.x, target.y);
        if (distance_to_target > 1) {
            console.log(" Not close enough to dropoff!");
            console.log(" DROPPING_OFF -> TRAVELING_TO_DROPOFF")

            this.memory.state = HaulerState.TRAVELING_TO_DROPOFF;
            return;
        }

        if (this.memory.current_task.task_type === HaulerDropoffType.STRUCTURE) {
            let structure = structureAtPosition(target);
            if (structure === null) {
                console.log(" Trying to return to structure, but it wasn't found!");
                console.log(" RETURNING_TO_STORAGE -> WAITING_FOR_DROPOFF_TASK");

                this.memory.current_task = null;
                this.memory.state = HaulerState.WAITING_FOR_DROPOFF_TASK;

                return;
            }

            let successful_transfer = this.creep.transfer(structure, RESOURCE_ENERGY);
            if (successful_transfer !== OK) {
                console.log(` Can't transfer to structure: ${successful_transfer}.`);
            }
        } else if(this.memory.current_task.task_type == HaulerDropoffType.CREEP) {
            // TODO[unfinished] Implement transfer to creep.
            console.log(" !!! Implement dropping off to creep !!!");
            console.log(" DROPPING_OFF -> WAITING_FOR_DROPOFF_TASK");

            this.memory.current_task = null;
            this.memory.state = HaulerState.WAITING_FOR_DROPOFF_TASK;

            return;
        }
    }
}


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

export enum HaulerPickupType {
    DROPPED_RESOURCE,
    CREEP,
    STRUCTURE,
}

export enum HaulerDropoffType {
    CREEP,
    STRUCTURE,
}

export class HaulerTask {
    task_type: HaulerPickupType | HaulerDropoffType;
    position: RoomPosition;
    resource_amount: number;
    resource_type: RESOURCE_ENERGY;

    // Only set if task_type == CREEP
    creep_name: string | null;

    constructor(task_type: HaulerPickupType | HaulerDropoffType, position: RoomPosition, resource_amount: number, creep_name: string | null = null) {
        this.task_type = task_type;
        this.position = position;
        this.resource_amount = resource_amount;

        // [improvement]: Implement other resource types
        this.resource_type = RESOURCE_ENERGY;

        this.creep_name = creep_name;
    }

    /**
     * Finds the difference between two HaulerTasks. This is used to reduce the task pool by tasks that haulers have
     * already picked up. `this` should be the task in the general task pool, and `hauler_task` should be the assigned
     * task.
     *
     * This must be run AFTER haulers grow their tasks.
     *
     * If the tasks don't match all of {task_type, position, resource_type, creep_name} (=> different tasks), returns `this`.
     * If the hauler task is the same size as this task, returns `null`.
     * If the hauler task is greater than the size of this task, we log an error, and return `null`.
     * If the hauler task is smaller than this task, this will return a new HaulerTask with the difference in resource amounts.
     */
    difference(hauler_task: HaulerTask): HaulerTask | null {
        if (
            this.task_type !== hauler_task.task_type ||
            !_.isEqual(this.position, hauler_task.position) ||
            this.resource_type !== hauler_task.resource_type ||
            this.creep_name !== hauler_task.creep_name
        ) {
            return this;
        }

        if (this.resource_amount === hauler_task.resource_amount) {
            return null;
        } else if (hauler_task.resource_amount > this.resource_amount) {
            console.log(`Hauler task unexpectedly bigger than this task.`);
            return null;
        } else {
            return new HaulerTask(
                this.task_type,
                this.position,
                this.resource_amount - hauler_task.resource_amount,
                this.creep_name
            )
        }
    }
}

export class HaulerTaskManager {
    haulers: Hauler[];
    rooms: Room[]
    primary_room: Room

    constructor(haulers: Hauler[], rooms: Room[], primary_room: Room) {
        this.haulers = haulers;
        this.rooms = rooms;
        this.primary_room = primary_room;
    }

    run () {
        console.log("Running HaulerTaskManager");
        this.allocateHaulerTasks();
    }

    visualizeTasks(pickup_tasks: HaulerTask[], dropoff_tasks: HaulerTask[], x_offset: number = 0, y_offset: number = 0): number {
        new RoomVisual().text("Pickup tasks:", x_offset, y_offset, { "align": "left" });
        y_offset += 1;

        for (let pickup_task of pickup_tasks) {
            let p = pickup_task.position;
            let creep_name = pickup_task.creep_name !== null ? " " + pickup_task.creep_name : "";
            new RoomVisual().text(
                `  [${HaulerPickupType[pickup_task.task_type] + creep_name}] ${pickup_task.resource_amount} ${pickup_task.resource_type} at Room[${p.roomName}](${p.x}, ${p.y}).`,
                x_offset,
                y_offset,
                { "align": "left" }
            );
            y_offset += 1;
        }

        new RoomVisual().text("Dropoff tasks:", x_offset, y_offset, { "align": "left" });
        y_offset += 1;

        for (let dropoff_task of dropoff_tasks) {
            let p = dropoff_task.position;
            let creep_name = dropoff_task.creep_name !== null ? " " + dropoff_task.creep_name : "";
            new RoomVisual().text(
                `  [${HaulerDropoffType[dropoff_task.task_type] + creep_name}] ${dropoff_task.resource_amount} ${dropoff_task.resource_type} at Room[${p.roomName}](${p.x}, ${p.y}).`,
                x_offset,
                y_offset,
                { "align": "left" }
            );
            y_offset += 1;
        }

        return 2 + pickup_tasks.length + dropoff_tasks.length;
    }

    allocateHaulerTasks() {
        let assigned_pickup_tasks: HaulerTask[] = [];
        let assigned_dropoff_tasks: HaulerTask[] = [];

        // Grow hauler tasks for each hauler currently executing tasks
        for (let hauler of this.haulers) {
            if (hauler.memory.state == HaulerState.TRAVELING_TO_PICKUP) {
                let pickup_task = hauler.growAndReturnTask();
                if (pickup_task !== null) {
                    assigned_pickup_tasks.push(pickup_task);
                }
            } else if (hauler.memory.state == HaulerState.TRAVELING_TO_DROPOFF) {
                let dropoff_task = hauler.growAndReturnTask();
                if (dropoff_task !== null) {
                    assigned_dropoff_tasks.push(dropoff_task);
                }
            }
        }

        // Generate pickup and dropoff tasks
        let new_pickup_tasks = this.generatePickupTasks();
        let new_dropoff_tasks = this.generateDropoffTasks();

        // let y_offset = this.visualizeTasks(new_pickup_tasks, new_dropoff_tasks);
        let y_offset = 0;

        // Remove tasks that are already claimed by haulers
        // TODO[optimize] Smarter subtraction here is possible. If a difference results in a split task, we can remove
        //  the assigned hauler task that was a part of the subtraction from the subsequent list to check.
        let available_pickup_tasks: HaulerTask[] = [];
        let available_dropoff_tasks: HaulerTask[] = [];

        for (let new_pickup_task of new_pickup_tasks) {
            let resulting_task = new_pickup_task;
            for (let assigned_pickup_task of assigned_pickup_tasks) {
                let task_diff = resulting_task.difference(assigned_pickup_task);

                if (task_diff !== null) {
                    resulting_task = task_diff;
                }
            }

            if (resulting_task !== null) {
                available_pickup_tasks.push(resulting_task);
            }
        }
        for (let new_dropoff_task of new_dropoff_tasks) {
            let resulting_task = new_dropoff_task;
            for (let assigned_dropoff_task of assigned_dropoff_tasks) {
                let task_diff = new_dropoff_task.difference(assigned_dropoff_task);

                if (task_diff !== null) {
                    resulting_task = task_diff;
                }
            }

            if (resulting_task !== null) {
                available_dropoff_tasks.push(resulting_task);
            }
        }

        this.visualizeTasks(available_pickup_tasks, available_dropoff_tasks, 0, y_offset + 1);

        // Allocate tasks to haulers that want them
        for (let hauler of this.haulers) {
            if (hauler.memory.state === HaulerState.WAITING_FOR_PICKUP_TASK) {
                available_pickup_tasks = hauler.choosePickupTask(available_pickup_tasks);
            } else if (hauler.memory.state === HaulerState.WAITING_FOR_DROPOFF_TASK) {
                available_dropoff_tasks = hauler.chooseDropoffTask(available_dropoff_tasks);
            }
        }
    }

    // TODO[improvement]: Destinations should include containers.
    // TODO[improvement]: Create tasks to fill up extensions and spawn from containers

    generatePickupTasks(): HaulerTask[] {
        let pickup_tasks: HaulerTask[] = [];

        // Create dropped resource pickup tasks
        for (let room of this.rooms) {
            let dropped_resources = room.find(FIND_DROPPED_RESOURCES);

            for (let dropped_resource of dropped_resources) {
                pickup_tasks.push(new HaulerTask(
                    HaulerPickupType.DROPPED_RESOURCE,
                    dropped_resource.pos,
                    dropped_resource.amount
                ));
            }
        }

        // Create miner pickup tasks
        for (let creep_name in Game.creeps) {
            let creep = Game.creeps[creep_name];
            let creep_memory = creep.memory as CustomCreepMemory;

            if (creep_memory.role === RoleType.MINER) {
                if (creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                    pickup_tasks.push(new HaulerTask(
                        HaulerPickupType.CREEP,
                        creep.pos,
                        creep.store.getUsedCapacity(RESOURCE_ENERGY),
                        creep.name
                    ));
                }
            }
        }

        return pickup_tasks;
    }

    generateDropoffTasks(): HaulerTask[] {
        let dropoff_tasks: HaulerTask[] = [];

        // This list is ordered by priority.
        // TODO[improvement]: Maybe more explicitly define task priority.

        // Generate spawn dropoff task
        let primary_room_spawn: StructureSpawn = Game.spawns[this.primary_room.find(FIND_MY_SPAWNS)[0].name];
        dropoff_tasks.push(new HaulerTask(
            HaulerDropoffType.STRUCTURE,
            primary_room_spawn.pos,
            primary_room_spawn.store.getFreeCapacity(RESOURCE_ENERGY)
        ));

        // Generate container dropoff task
        for (let room of this.rooms) {
            let containers: StructureContainer[] = room.find(FIND_STRUCTURES, {filter: (structure) => structure.structureType == STRUCTURE_CONTAINER});

            // TODO[assumption]: every container wants energy
            for (let container of containers) {
                dropoff_tasks.push(new HaulerTask(
                    HaulerDropoffType.STRUCTURE,
                    container.pos,
                    container.store.getFreeCapacity(RESOURCE_ENERGY)
                ));
            }
        }

        // Generate creep dropoff task
        for (let creep_name in Game.creeps) {
            let creep = Game.creeps[creep_name];
            let creep_memory = creep.memory as CustomCreepMemory;

            if (creep_memory.role == RoleType.UPGRADER) {
                dropoff_tasks.push(new HaulerTask(
                    HaulerDropoffType.CREEP,
                    creep.pos,
                    creep.store.getFreeCapacity(RESOURCE_ENERGY),
                    creep.name
                ))
            }
        }

        return dropoff_tasks;
    }
}
