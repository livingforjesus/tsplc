import { basename } from "node:path";
import type { Variable, VerifiedCoreModule } from "@vplc/compiler/ir";

interface GlobalList {
  id: string;
  module: string;
  storage: "constants" | "retained" | "state";
  variables: Variable[];
}

/** CODESYS promotes an enclosing instance when private child state is retained. */
export function storageLayout(core: VerifiedCoreModule) {
  const types = new Map(core.types.map((type) => [type.id, type]));
  const blocks = new Map(core.blocks.map((block) => [block.id, block]));
  const retention = new Map<string, boolean>();
  const blockRetained = (id: string): boolean => {
    const cached = retention.get(id);
    if (cached !== undefined) return cached;
    const block = blocks.get(id);
    if (!block) throw new Error("Missing verified block during retention planning.");
    const retained = block.state.some((field) => {
      const type = types.get(field.type);
      return field.retain || (type?.kind === "block" && blockRetained(type.block));
    });
    retention.set(id, retained);
    return retained;
  };

  const retainedBlocks = new Set(
    core.blocks.filter((block) => blockRetained(block.id)).map((block) => block.id),
  );
  const retainedVariables = new Set(
    [...core.variables, ...core.blocks.flatMap((block) => block.state)]
      .filter((variable) => {
        const type = types.get(variable.type);
        return variable.retain || (type?.kind === "block" && retainedBlocks.has(type.block));
      })
      .map((variable) => variable.id),
  );

  const groups = new Map<string, GlobalList>();
  for (const variable of core.variables) {
    if (variable.storage === "input" || variable.storage === "output") continue;
    const storage =
      variable.storage === "constant"
        ? "constants"
        : retainedVariables.has(variable.id)
          ? "retained"
          : "state";
    const id = `${variable.span.file}:${storage}`;
    let group = groups.get(id);
    if (!group) {
      group = {
        id,
        module: basename(variable.span.file).replace(/\.[^.]+$/, ""),
        storage,
        variables: [],
      };
      groups.set(id, group);
    }
    group.variables.push(variable);
  }
  return { retainedBlocks, retainedVariables, globalLists: [...groups.values()] };
}
