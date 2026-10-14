import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { URI } from "vscode-uri";
import { LanguageService } from "../language/service";

export type Settings = { sourceRoots: string[]; libraryPaths: string[] };
export type SourceProject = {
  root: string;
  service: LanguageService;
  uris: Set<string>;
};
const excluded = new Set([
  "node_modules",
  "build",
  "dist",
  "vendor",
  "target",
  "coverage",
  "artifacts",
]);
const contains = (root: string, path: string) => {
  const local = relative(root, path);
  return local === "" || (!local.startsWith(`..${sep}`) && local !== ".." && !isAbsolute(local));
};
const isSource = (name: string) => /\.(st|iecst)$/i.test(name);

/** Reads only source text. Never imports codesys-build.config.ts or invokes the build tool. */
export class Workspace {
  readonly buffers = new Map<string, { text: string; version: number }>();
  projects: SourceProject[] = [];
  private generation = 0;
  constructor(
    public folders: string[],
    public settings: Settings,
    private readonly log: (message: string) => void,
  ) {}
  private async walk(
    root: string,
    visitor: (directory: string, entries: Dirent[]) => Promise<boolean | undefined>,
  ): Promise<void> {
    const pending = [root];
    let count = 0;
    for (const directory of pending) {
      if (count++ >= 20000) {
        break;
      }
      let entries: Dirent[];
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        this.log(`Cannot read ${directory}: ${String(error)}`);
        continue;
      }
      if ((await visitor(directory, entries)) === false) {
        continue;
      }
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith(".") && !excluded.has(entry.name)) {
          pending.push(join(directory, entry.name));
        }
      }
    }
    if (count >= 20000) {
      this.log(
        `Discovery limit reached at ${root}. Configure codesysST.sourceRoots to narrow the workspace.`,
      );
    }
  }
  private async roots(folder: string): Promise<string[]> {
    if (this.settings.sourceRoots.length) {
      return this.settings.sourceRoots.map((root) => resolve(folder, root));
    }
    const roots: string[] = [];
    await this.walk(folder, async (directory, entries) => {
      if (
        entries.some(
          (entry) =>
            entry.isFile() && /^(?:vplc|codesys-build)\.config\.(?:[cm]?[jt]s)$/i.test(entry.name),
        )
      ) {
        let root = join(directory, "src");
        try {
          const manifest = JSON.parse(
            await readFile(join(directory, ".vplc/project.json"), "utf8"),
          );
          root = resolve(
            directory,
            manifest.config?.compiler
              ? ".vplc/artifacts/st"
              : (manifest.config?.build?.sourceDir ?? "src"),
          );
        } catch {
          /* A raw source project works before its first type generation. */
        }
        try {
          if ((await stat(root)).isDirectory()) {
            roots.push(root);
            return false;
          }
        } catch {
          this.log(
            `No src directory beside ${directory}/codesys-build.config. Configure codesysST.sourceRoots for custom paths.`,
          );
        }
      }
    });
    return roots.length ? roots : [folder];
  }
  private async sources(root: string, service: LanguageService, uris: Set<string>) {
    await this.walk(root, async (directory, entries) => {
      await Promise.all(
        entries
          .filter((entry) => entry.isFile() && isSource(entry.name))
          .map(async (entry) => {
            const path = join(directory, entry.name);
            const uri = URI.file(path).toString();
            try {
              if ((await stat(path)).size > 2 * 1024 * 1024) {
                this.log(`Source exceeds 2 MiB editor limit: ${path}`);
                return;
              }
              service.setDocument(uri, await readFile(path, "utf8"));
              uris.add(uri);
            } catch (error) {
              this.log(`Cannot read ${path}: ${String(error)}`);
            }
          }),
      );
    });
  }
  async refresh(): Promise<boolean> {
    const generation = ++this.generation;
    const projects: SourceProject[] = [];
    for (const folder of this.folders) {
      for (const root of await this.roots(folder)) {
        if (projects.some((project) => project.root === root)) {
          continue;
        }
        const service = new LanguageService();
        const uris = new Set<string>();
        await this.sources(root, service, uris);
        for (const library of this.settings.libraryPaths) {
          await this.sources(resolve(folder, library), service, uris);
        }
        projects.push({ root, service, uris });
      }
    }
    if (generation !== this.generation) {
      return false;
    }
    this.projects = projects.sort((a, b) => b.root.length - a.root.length);
    for (const [uri, buffer] of this.buffers) {
      this.setDocument(uri, buffer.text, buffer.version);
    }
    return true;
  }
  service(uri: string): LanguageService {
    const path = URI.parse(uri).fsPath;
    const project =
      this.projects.find((item) => contains(item.root, path)) ??
      this.projects.find((item) => item.uris.has(uri));
    if (project) {
      return project.service;
    }
    const isolated = {
      root: path,
      service: new LanguageService(),
      uris: new Set([uri]),
    };
    this.projects.push(isolated);
    return isolated.service;
  }
  setDocument(uri: string, text: string, version: number): void {
    this.buffers.set(uri, { text, version });
    this.service(uri).setDocument(uri, text, version);
    for (const project of this.projects.filter((item) => item.uris.has(uri))) {
      project.service.setDocument(uri, text, version);
    }
  }
  closeDocument(uri: string): void {
    this.buffers.delete(uri);
  }
  allUris(): string[] {
    return [
      ...new Set([
        ...this.projects.flatMap((project) => [...project.uris]),
        ...this.buffers.keys(),
      ]),
    ];
  }
}
