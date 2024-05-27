import { MinerMemory } from "roles/miner";
import { HaulerMemory } from "roles/hauler";
import { makeid } from "utils/Id";
import { CustomCreepMemory, RoleCount, RoleType } from "common";

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
function createHaulerCreep() {
  Game.spawns["Spawn1"].spawnCreep(
    [CARRY, CARRY, MOVE],
    `Hauler_${makeid(5)}`,
    { memory: new HaulerMemory() }
  );
}

const MINER_BODY = [CARRY, WORK, MOVE];
function canCreateMiner(spawn: StructureSpawn): boolean {
  return spawn.store.energy >= _.sum(MINER_BODY, (part) => BODY_COSTS[part]);
}
function createMinerCreep(): boolean {
  let sources = Game.rooms["sim"].find(FIND_SOURCES);
  if (sources.length > 0) {
    let chosen_source: Source | null = null;

    for (let source of sources) {
      if (countAssignedMiners(source) < countMiningSpots(source)) {
        chosen_source = source;
        break;
      }
    }

    if (chosen_source === null) {
      console.log("No more mining spots available!");
      return false;
    }

    let did_spawn = Game.spawns["Spawn1"].spawnCreep(
      [WORK, CARRY, MOVE],
      `Miner_${makeid(5)}`,
      { memory: new MinerMemory(chosen_source.id) }
    );

    if (did_spawn !== OK) {
      console.log(`Couldn't spawn miner: ${did_spawn}.`);
      return false;
    }

    return true;
  } else {
    console.log("Can't create miner, no sources found.");
    return false;
  }
}

export function countMiningSpots(source: Source): number {
  let SURROUNDING_SPOTS = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0],           [1, 0],
    [-1, 1],  [0, 1],  [1, 1]
  ];

  let count_walkable = 0;
  let room_terrain = Game.rooms[source.room.name].getTerrain();

  for (let spot of SURROUNDING_SPOTS) {
    if (room_terrain.get(spot[0] + source.pos.x, spot[1] + source.pos.y) != TERRAIN_MASK_WALL) {
      count_walkable += 1;
    }
  }

  return count_walkable;
}

export function countAssignedMiners(source: Source) {
  let assigned_miners = 0;

  for (let creep_name in Game.creeps) {
    let creep = Game.creeps[creep_name];
    let creep_memory = creep.memory as CustomCreepMemory;

    if (creep_memory.role === RoleType.MINER) {
      let miner_memory = creep.memory as MinerMemory;

      if (miner_memory.custom_memory.source_id === source.id) {
        assigned_miners += 1;
      }
    }
  }

  return assigned_miners;
}

export function createCreeps(current_role_counts: RoleCount) {
  if (current_role_counts.harvesters == 0 && canCreateHauler(Game.spawns["Spawn1"])) {
    console.log("No harvesters, creating new one.");
    createMinerCreep();
  } else if (current_role_counts.haulers < current_role_counts.harvesters && canCreateMiner(Game.spawns["Spawn1"])) {
    console.log("Fewer haulers than harvesters, creating new one.");
    createHaulerCreep();
  } else if (canCreateMiner(Game.spawns["Spawn1"])) {
    console.log("Equal harvesters and haulers, creating new harvester.");
    createMinerCreep();
  }
}
