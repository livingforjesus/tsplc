import type { Diagnostic, EmitResult } from "@vplc/compiler/ir";
import { CodesysCompilerError } from "@vplc/build";
import type { SourceMapping } from "./emit.ts";

type MappedBundle = Pick<EmitResult, "objects"> & { mappings: readonly SourceMapping[] };

/** Map verified vendor locations; preserve raw context for everything else. */
export function diagnoseCodesys(cause: unknown, bundle: MappedBundle): readonly Diagnostic[] {
  const notes: string[] = [];
  let current = cause;
  while (current instanceof Error) {
    if (current instanceof CodesysCompilerError && current.diagnostics.length) {
      return current.diagnostics.map((item) => {
        // Observed in CODESYS 3.5 SP22. position itself is an opaque vendor value.
        const location =
          item.positionText &&
          /^Line ([1-9][0-9]*)(?:, Column ([1-9][0-9]*))? \((Decl|Impl)\)$/.exec(item.positionText);
        const identity = item.object;
        let objectPath: string | undefined;
        if (identity && identity.path.at(-1) === identity.name) {
          const relative = identity.applicationPath;
          if (
            Array.isArray(relative) &&
            relative.length > 0 &&
            relative.every((part) => typeof part === "string") &&
            identity.isApplicationChild === (relative.length === 1) &&
            identity.path.length > relative.length &&
            identity.path.slice(-relative.length).every((part, index) => part === relative[index])
          ) {
            objectPath = relative.join("/");
          } else if (
            relative === undefined &&
            identity.isApplicationChild === true &&
            identity.path.length >= 2
          ) {
            // A verified immediate Application parent proves the root identity.
            objectPath = identity.name;
          }
        }
        const objects = objectPath
          ? bundle.objects.flatMap((object) => {
              const declaration =
                object.sourcePath ??
                (object.implementation === undefined
                  ? `${object.name}.st`
                  : `${object.name}/declaration.st`);
              return object.name === identity?.name &&
                declaration.replace(
                  object.implementation === undefined ? /\.st$/ : /\/declaration\.st$/,
                  "",
                ) === objectPath
                ? [{ object, declaration }]
                : [];
            })
          : [];
        const match = objects.length === 1 ? objects[0] : undefined;
        const section = location?.[3] === "Decl" ? "declaration" : "implementation";
        const path =
          section === "declaration"
            ? match?.declaration
            : match?.object.implementation !== undefined
              ? match.declaration.replace(/declaration\.st$/, "implementation.st")
              : undefined;
        const mappings =
          location && path
            ? bundle.mappings.filter(
                (mapping) => mapping.path === path && mapping.line === Number(location[1]),
              )
            : [];
        const mapping = mappings.length === 1 ? mappings[0] : undefined;
        return {
          origin: "vendor",
          code: "PLC8001",
          severity: "error",
          message: item.text,
          ...(mapping && { span: mapping.span }),
          notes: [
            ...notes,
            ...(location && path
              ? [
                  "Generated ST: " +
                    path +
                    ":" +
                    location[1] +
                    (location[2] ? `:${location[2]}` : ""),
                ]
              : []),
            `CODESYS diagnostic: ${JSON.stringify(item)}`,
          ],
        };
      });
    }
    notes.push(current.message);
    if (current.cause === undefined) break;
    current = current.cause;
    if (!(current instanceof Error)) notes.push(String(current));
  }
  return [
    {
      origin: "vendor",
      code: "PLC8001",
      severity: "error",
      message: cause instanceof Error ? cause.message : String(cause),
      ...(notes.length > 1 && { notes: notes.slice(1) }),
    },
  ];
}
