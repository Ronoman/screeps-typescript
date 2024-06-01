import { MinerMemory } from "roles/miner";
import { HaulerMemory } from "roles/hauler";
import { makeid } from "utils/Id";
import { CustomCreepMemory, RoleType } from "common";

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
function createHaulerCreep() {
  Game.spawns["Spawn1"].spawnCreep(
    [CARRY, CARRY, MOVE],
    `Hauler_${makeid(5)}`,
    { memory: new HaulerMemory() }
  );
}

const MINER_BODY = [CARRY, WORK, MOVE];
function createMinerCreep(): boolean {
  let sources = Game.rooms["sim"].find(FIND_SOURCES);
  if (sources.length > 0) {
    let chosen_source: Source | null = null;

    for (let source of sources) {
      if (countAssignedMiners(source) < countMiningSpots(source) && !isSourceGuarded(source)) {
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

function countMiningSpots(source: Source): number {
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

function countAssignedMiners(source: Source) {
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

function isSourceGuarded(source: Source): boolean {
  let room = Game.rooms[source.room.name];
  let lairs_in_room = room.find(FIND_HOSTILE_STRUCTURES, {filter: (structure) => { return structure.structureType == STRUCTURE_KEEPER_LAIR }});

  for (let lair of lairs_in_room) {
    if (lair.pos.getRangeTo(source.pos.x, source.pos.y) < 20) {
      return true;
    }
  }

  return false;
}

const UPGRADER_BODY = [CARRY, WORK, MOVE];
// function createUpgraderCreep(): boolean {

// }

function canCreateCreep(spawn: StructureSpawn, body: BodyPartConstant[]) {
  return spawn.store.energy >= _.sum(body, (part) => BODY_COSTS[part]);
}

export function createCreeps(miner_count: number, hauler_count: number) {
  if (miner_count == 0 && canCreateCreep(Game.spawns["Spawn1"], MINER_BODY)) {
    console.log("No miners, creating new one.");
    createMinerCreep();
  } else if (hauler_count < miner_count && canCreateCreep(Game.spawns["Spawn1"], HAULER_BODY)) {
    console.log("Fewer haulers than miners, creating new one.");
    createHaulerCreep();
  } else if (canCreateCreep(Game.spawns["Spawn1"], MINER_BODY)) {
    console.log("Equal miners and haulers, creating new harvester.");
    createMinerCreep();
  } else {
    console.log("No more creeps to create! Consider getting good.");
  }
}
