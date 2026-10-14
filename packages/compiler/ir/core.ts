import type { Diagnostic } from "./diagnostics.ts";
import type { PlcModule } from "./model.ts";
import {
  verified,
  type VerifiedCoreModule,
  type CoreFunction,
  type CoreFunctionBlock,
} from "./core-model.ts";
import { ModuleDeclarations } from "./declarations.ts";
import { checkStaticAllocation } from "./allocation.ts";
import { RoutineNormalizer } from "./routine.ts";
import { linkModule } from "./link.ts";
import { InvalidCore } from "./normalization-error.ts";

export type {
  CorePath,
  CheckedPlace,
  CoreExpression,
  CoreStatement,
  CoreFunction,
  CoreFunctionBlock,
  VerifiedCoreModule,
} from "./core-model.ts";

const verifiedModules = new WeakSet<object>();
export function isVerifiedCore(value: unknown): value is VerifiedCoreModule {
  return typeof value === "object" && value !== null && verifiedModules.has(value);
}

function freeze(value: unknown): void {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) freeze(child);
  Object.freeze(value);
}
// The module crosses the trust boundary only after admission, lowering and linking.
export function normalizeModule(module: PlcModule): {
  core?: VerifiedCoreModule;
  diagnostics: readonly Diagnostic[];
} {
  try {
    const declarations = new ModuleDeclarations(module);
    checkStaticAllocation(module, declarations);

    const functions: CoreFunction[] = [],
      blocks: CoreFunctionBlock[] = [];
    const edges = new Map<string, ReadonlySet<string>>();
    for (const source of [...module.functions, ...module.blocks]) {
      const normalized = new RoutineNormalizer(source, declarations).normalize();
      edges.set(source.id, normalized.callees);
      if ("inputs" in normalized.routine) blocks.push(normalized.routine);
      else functions.push(normalized.routine);
    }

    const linked = linkModule(module, declarations, functions, blocks, edges);
    const core: VerifiedCoreModule = { ...structuredClone(linked), [verified]: true };
    freeze(core);
    verifiedModules.add(core);
    return { core, diagnostics: [] };
  } catch (cause) {
    if (cause instanceof InvalidCore) return { diagnostics: [cause.diagnostic] };
    throw cause;
  }
}
