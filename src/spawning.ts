import { MinerMemory, MinerMemoryFields } from "roles/miner";

function create_miner_creep(id: string) {
    let sources = Game.rooms["sim"].find(FIND_SOURCES);
    if (sources.length > 0) {
      let source = sources[0];
      Game.spawns["Spawn1"].spawnCreep(
        [WORK, CARRY, MOVE],
        `Miner_${id}`,
        { memory: new MinerMemory(new MinerMemoryFields(source.id))}
      );
    } else {
      console.log("Can't create miner, no sources found.");
    }
  }
