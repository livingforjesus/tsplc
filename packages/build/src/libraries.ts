import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import type { LibraryDependency } from "@tsplc/config";

export const libraryRegistry = "https://store-archive.codesys.com/CODESYSLibs";
const libraryFile = /\.(?:compiled-library(?:-v\d+)?|library)$/i;
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export interface InstalledLibrary {
  title: string;
  company?: string;
  version?: string;
  namespace?: string;
  path: string;
  sha256: string;
  url?: string;
}
interface LibraryLock {
  version: 1;
  dependencies: Record<string, InstalledLibrary>;
}
const hash = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const component = (name: string) => {
  if (!name.trim() || /[/\\\0\r\n]/.test(name) || name === "." || name === "..")
    throw new Error(`Invalid library registry component: ${name}.`);
  return encodeURIComponent(name);
};
async function response(url: string, fetcher: Fetcher) {
  const result = await fetcher(url, { signal: AbortSignal.timeout(30_000) });
  if (!result.ok) throw new Error(`Library registry ${result.status}: ${url}`);
  return result;
}
export async function libraryIndex(
  path: string[] = ["System"],
  fetcher: Fetcher = fetch,
): Promise<string[]> {
  const url = `${libraryRegistry}/${path.map(component).join("/")}/index`;
  const result = await response(url, fetcher);
  const text = await result.text();
  if (text.length > 4_000_000 || /<html/i.test(text))
    throw new Error(`Invalid library registry index: ${url}`);
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}
export async function validateLibrary(
  title: string,
  version: string,
  company = "System",
  fetcher: Fetcher = fetch,
) {
  if (!(await libraryIndex([company], fetcher)).includes(title))
    throw new Error(`Unknown CODESYS library ${company}/${title}. Names are case sensitive.`);
  const versions = await libraryIndex([company, title], fetcher);
  if (!versions.includes(version))
    throw new Error(`Unknown version ${version} for ${title}. Available: ${versions.join(", ")}`);
  const filenames = (await libraryIndex([company, title, version], fetcher)).filter((name) =>
    libraryFile.test(name),
  );
  if (filenames.length !== 1)
    throw new Error(
      `Expected one library payload for ${title} ${version}, received ${filenames.length}.`,
    );
  return {
    filename: filenames[0]!,
    url: `${libraryRegistry}/${[company, title, version, filenames[0]!].map(component).join("/")}`,
  };
}
export async function installLibraries(
  dependencies: Record<string, LibraryDependency>,
  root: string,
  options: { frozen?: boolean; fetcher?: Fetcher } = {},
) {
  const file = resolve(root, "tsplc.lock.json"),
    store = resolve(root, ".tsplc/libraries");
  let previous: LibraryLock = { version: 1, dependencies: {} };
  try {
    previous = JSON.parse(await readFile(file, "utf8"));
  } catch (cause) {
    if (!(cause && typeof cause === "object" && "code" in cause && cause.code === "ENOENT"))
      throw cause;
  }
  if (previous.version !== 1 || !previous.dependencies || typeof previous.dependencies !== "object")
    throw new Error("Invalid tsplc.lock.json.");
  const installed: Record<string, InstalledLibrary> = {};
  const fetcher = options.fetcher ?? fetch;
  await mkdir(store, { recursive: true });
  for (const [title, dependency] of Object.entries(dependencies)) {
    component(title);
    const settings = typeof dependency === "string" ? { version: dependency } : dependency;
    const locked = previous.dependencies[title];
    const prior = locked ? { ...locked, path: resolve(root, locked.path) } : undefined;
    const same =
      prior !== undefined &&
      prior.namespace === settings.namespace &&
      ("path" in settings
        ? prior.url === undefined && prior.path === resolve(root, settings.path)
        : prior.version === settings.version && prior.company === (settings.company ?? "System"));
    if (same) {
      try {
        if (hash(await readFile(prior.path)) === prior.sha256) {
          installed[title] = prior;
          continue;
        }
      } catch {
        /* Missing cache can be restored from the exact URL. */
      }
      if (options.frozen) throw new Error(`Locked library ${title} is missing or changed.`);
    } else if (options.frozen) throw new Error(`Dependency ${title} differs from tsplc.lock.json.`);
    if ("path" in settings) {
      const path = resolve(root, settings.path);
      if (!libraryFile.test(path))
        throw new Error(`${title}: expected a .library or .compiled-library file.`);
      installed[title] = {
        title,
        path,
        sha256: hash(await readFile(path)),
        ...(settings.namespace ? { namespace: settings.namespace } : {}),
      };
    } else {
      const company = settings.company ?? "System";
      const payload = await validateLibrary(title, settings.version, company, fetcher);
      const result = await response(payload.url, fetcher);
      const data = new Uint8Array(await result.arrayBuffer());
      if (!data.length || data.length > 256 * 1024 * 1024)
        throw new Error(`${title}: invalid library payload size.`);
      const sha256 = hash(data);
      // An existing lock pins the payload, even if the registry later changes it.
      if (same && prior.sha256 !== sha256)
        throw new Error(
          `Registry payload changed for locked library ${title} ${settings.version}.`,
        );
      const path = resolve(store, `${sha256}-${basename(payload.filename)}`),
        temp = `${path}.${randomUUID()}.tmp`;
      await writeFile(temp, data, { flag: "wx" });
      await rename(temp, path);
      installed[title] = {
        title,
        company,
        version: settings.version,
        path,
        sha256,
        url: payload.url,
        ...(settings.namespace ? { namespace: settings.namespace } : {}),
      };
    }
  }
  if (
    options.frozen &&
    Object.keys(previous.dependencies).some((name) => !Object.hasOwn(dependencies, name))
  )
    throw new Error("Removed dependencies differ from tsplc.lock.json.");
  if (!options.frozen) {
    const temp = `${file}.${randomUUID()}.tmp`;
    const portable = Object.fromEntries(
      Object.entries(installed).map(([title, library]) => [
        title,
        { ...library, path: relative(root, library.path).replaceAll("\\", "/") },
      ]),
    );
    await writeFile(temp, JSON.stringify({ version: 1, dependencies: portable }, null, 2) + "\n");
    await rename(temp, file);
  }
  return Object.values(installed);
}
