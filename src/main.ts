import { ErrorMapper } from "utils/ErrorMapper";
import { RoleType, CustomCreepMemory } from "common";
import { Miner } from "roles/miner";
import { Hauler } from "roles/hauler";
import { createCreeps } from "spawning";
import { HaulerTaskManager } from "roles/hauler";


class CreepsByRole {
  miners: Miner[];
  haulers: Hauler[];

  constructor() {
    this.miners = [];
    this.haulers = [];
  }
}

declare global {
  /*
    Example types, expand on these or remove them and add your own.
    Note: Values, properties defined here do no fully *exist* by this type definiton alone.
          You must also give them an implemention if you would like to use them. (ex. actually setting a `role` property in a Creeps memory)

    Types added in this `global` block are in an ambient, global context. This is needed because `main.ts` is a module file (uses import or export).
    Interfaces matching on name from @types/screeps will be merged. This is how you can extend the 'built-in' interfaces from @types/screeps.
  */
  // Memory extension samples
  interface Memory {
    uuid: number;
    log: any;
  }

  // Syntax for adding proprties to `global` (ex "global.log")
  namespace NodeJS {
    interface Global {
      log: any;
    }
  }
}

// When compiling TS to JS and bundling with rollup, the line numbers and file names in error messages change
// This utility uses source maps to get the line numbers and file names of the original, TS source code
export const loop = ErrorMapper.wrapLoop(() => {
  // console.log(`Current game tick is ${Game.time}`);

  // Automatically delete memory of missing creeps
  for (const name in Memory.creeps) {
    if (!(name in Game.creeps)) {
      delete Memory.creeps[name];
    }
  }

  let creeps_by_role = new CreepsByRole();

  for (let creep_name in Game.creeps) {
    let creep = Game.creeps[creep_name];
    let creep_memory = creep.memory as CustomCreepMemory;

    if (creep_memory.role === RoleType.MINER) {
      creeps_by_role.miners.push(new Miner(creep));
    } else if(creep_memory.role === RoleType.HAULER) {
      creeps_by_role.haulers.push(new Hauler(creep));
    }
  }

  console.log(`----- Game time: ${Game.time} -----`);

  for (let miner of creeps_by_role.miners) {
    miner.run(creeps_by_role.haulers.length);
  }

  new HaulerTaskManager(creeps_by_role.haulers, [Game.rooms["sim"]], Game.rooms["sim"]).run();

  for (let hauler of creeps_by_role.haulers) {
    hauler.run();
  }

  createCreeps(creeps_by_role.miners.length, creeps_by_role.haulers.length);

  // let all_hauler_tasks = generateAllHaulerTasks([Game.rooms["sim"]], Game.rooms["sim"]);
  // visualizeHaulerTasks(all_hauler_tasks[0], all_hauler_tasks[1]);
});
