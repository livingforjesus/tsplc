import type { PlcModule } from "./model.ts";
import type { ModuleDeclarations } from "./declarations.ts";
import { reject } from "./normalization-error.ts";

export function checkStaticAllocation(module: PlcModule, declarations: ModuleDeclarations): void {
  const { types, blocks } = declarations;

  // Declaration admission closes these registries over every referenced type
  // and block before allocation starts; a missing entry cannot be authored here.
  // Static allocation is a separate graph from scan calls: even an unused child
  // consumes memory, and a recursive child cannot be allocated by value.
  const payloads = new Map<string, number>();
  const payload = (id: string): number => {
    const cached = payloads.get(id);
    if (cached !== undefined) return cached;
    const type = types.get(id)!;
    const size =
      type.kind === "array"
        ? type.length * payload(type.element)
        : type.kind === "record"
          ? type.fields.reduce((sum, field) => sum + payload(field.type), 0)
          : 1;
    payloads.set(id, size);
    return size;
  };

  const allocations = new Map<string, { size: number; height: number }>(),
    allocating = new Set<string>();
  const allocation = (id: string): { size: number; height: number } => {
    if (allocating.size >= 64)
      reject("Static block allocation nesting exceeds 64 levels.", blocks.get(id)?.span);
    if (allocating.has(id)) reject("Recursive static block allocation.", blocks.get(id)?.span);
    const cached = allocations.get(id);
    if (cached) return cached;
    allocating.add(id);
    const block = blocks.get(id)!;
    const children = block.state
      .filter((item) => item.storage === "instance")
      .map((item) => {
        const type = types.get(item.type)!;
        return allocation(type.kind === "block" ? type.block : "");
      });
    const own = [
      ...block.inputs,
      ...block.outputs,
      ...block.state.filter((item) => item.storage !== "instance"),
    ].reduce((sum, item) => sum + (item.mode === "inOut" ? 1 : payload(item.type)), 1);
    const size = own + children.reduce((sum, child) => sum + child.size, 0),
      height = children.length ? 1 + Math.max(...children.map((child) => child.height)) : 1;
    if (size > 1_000_000 || height > 64)
      reject("Static block allocation exceeds its finite budget.", block.span);
    allocating.delete(id);
    const result = { size, height };
    allocations.set(id, result);
    return result;
  };

  for (const block of module.blocks) allocation(block.id);
  const staticPayload = module.variables.reduce((sum, variable) => {
    const type = types.get(variable.type)!;
    return sum + (type.kind === "block" ? allocation(type.block).size : payload(variable.type));
  }, 0);
  if (staticPayload > 1_000_000)
    reject("Static module storage exceeds one million scalar elements.");
}
