import { spawn } from "child_process";
import { makeid } from "utils/Id";

export function createRoomCreeps(room: Room) {
    if (room.controller === undefined) {
        return;
    }
    if (room.controller.level < 2) {
        let DESIRED_CREEP_COUNT = 3;
        let CREEP_BODY = [WORK, CARRY, MOVE];

        console.log(`Deciding whether to create creeps in room '${room.name}'.`);

        let current_creep_count = _.filter(Game.creeps, {"room": room.name}).length;
        if (current_creep_count < DESIRED_CREEP_COUNT) {
            let spawnsInRoom: AnyStructure[] = room.find(FIND_STRUCTURES, {filter: (structure) => {structure.structureType == STRUCTURE_SPAWN}});

            if (spawnsInRoom[0].structureType == STRUCTURE_SPAWN) {
                let spawn = spawnsInRoom[0];
                let spawnCreepReturn = spawn.spawnCreep(CREEP_BODY, "Worker_" + makeid(5));

                if (spawnCreepReturn != 0) {
                    console.log(`Failed to create creep: ${spawnCreepReturn}`);
                }
            }
        }
        console.log(`There are ${current_creep_count} creeps in ${room.name}`);
    } else {
        console.log(`Implement logic for room level ${room.controller.level}!`);
    }
}
