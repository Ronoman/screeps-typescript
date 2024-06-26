import { ErrorMapper } from "utils/ErrorMapper";
import { RoleType, RoleCount, CustomCreepMemory } from "common";
import { runMiner } from "roles/miner";
import { runHauler, generateHaulerTasks } from "roles/hauler";
import { createCreeps } from "spawning";


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

  let current_role_counts = countRoles();

  for (let creep_name in Game.creeps) {
    let creep = Game.creeps[creep_name];
    let creep_memory = creep.memory as CustomCreepMemory;

    if (creep_memory.role === RoleType.MINER) {
      runMiner(creep, current_role_counts);
    } else if(creep_memory.role === RoleType.HAULER) {
      let sim_room = Game.rooms["sim"];
      runHauler(creep, current_role_counts, generateHaulerTasks([sim_room], sim_room));
    }
  }

  createCreeps(current_role_counts);

  // let source = Game.getObjectById(<Id<Source>> "7dd64ef022c0812953450aa8");
  // if (source !== null) {
  //   console.log(`Walkable spots around closest source: ${countMiningSpots(source)}`);
  //   console.log(`Currently assigned miners: ${countAssignedMiners(source)}`);
  //   isSourceGuarded(source);
  // }
});

function countRoles(): RoleCount {
  let current_role_counts = new RoleCount(0, 0, 0);
  for (let creep_name in Game.creeps) {
    let creep: Creep = Game.creeps[creep_name];
    let creep_memory = creep.memory as CustomCreepMemory;

    if (creep_memory.role == RoleType.MINER) {
      current_role_counts.harvesters += 1;
    } else if (creep_memory.role == RoleType.HAULER) {
      current_role_counts.haulers += 1;
    } else if (creep_memory.role == RoleType.BUILDER) {
      current_role_counts.builders += 1;
    }
  }

  return current_role_counts;
}
