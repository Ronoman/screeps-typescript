import { ErrorMapper } from "utils/ErrorMapper";
import { RoleType, RoleCount, CustomCreepMemory } from "common";
import { MinerMemory, runMiner } from "roles/miner";
import { HaulerMemory, runHauler, generateHaulerTasks } from "roles/hauler";
import { makeid } from "utils/Id";


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

  if (current_role_counts.harvesters == 0 && canCreateHauler(Game.spawns["Spawn1"])) {
    console.log("No harvesters, creating new one.");
    createMinerCreep(makeid(5));
  } else if (current_role_counts.haulers < current_role_counts.harvesters && canCreateMiner(Game.spawns["Spawn1"])) {
    console.log("Fewer haulers than harvesters, creating new one.");
    createHaulerCreep(makeid(5));
  } else if (canCreateMiner(Game.spawns["Spawn1"])) {
    console.log("Equal harvesters and haulers, creating new harvester.");
    createMinerCreep(makeid(5));
  }
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

const BODY_COSTS = {
  "move": 50,
  "work": 100,
  "attack": 80,
  "carry": 50,
  "heal": 250,
  "ranged_attack": 150,
  "tough": 10,
  "claim": 600
}

const HAULER_BODY = [CARRY, CARRY, MOVE];
function canCreateHauler(spawn: StructureSpawn): boolean {
  return spawn.store.energy >= _.sum(HAULER_BODY, (part) => BODY_COSTS[part]);
}
function createHaulerCreep(id: string) {
  Game.spawns["Spawn1"].spawnCreep(
    [CARRY, CARRY, MOVE],
    `Hauler_${id}`,
    { memory: new HaulerMemory() }
  );
}

const MINER_BODY = [CARRY, WORK, MOVE];
function canCreateMiner(spawn: StructureSpawn): boolean {
  return spawn.store.energy >= _.sum(MINER_BODY, (part) => BODY_COSTS[part]);
}
function createMinerCreep(id: string) {
  let sources = Game.rooms["sim"].find(FIND_SOURCES);
  if (sources.length > 0) {
    let source = sources[0];
    Game.spawns["Spawn1"].spawnCreep(
      [WORK, CARRY, MOVE],
      `Miner_${id}`,
      { memory: new MinerMemory(source.id) }
    );
  } else {
    console.log("Can't create miner, no sources found.");
  }
}
