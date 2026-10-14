import {
  AttributeIds,
  BrowseDirection,
  makeResultMask,
  MessageSecurityMode,
  NodeClass,
  ObjectIds,
  OPCUAClient,
  resolveNodeId,
  SecurityPolicy,
  TimestampsToReturn,
  UserTokenType,
  type ClientSession,
  type ClientSubscription,
  type DataValue,
  type NodeIdLike,
} from "node-opcua-client";
import { OPCUACertificateManager } from "node-opcua-certificate-manager";
import { resolve } from "node:path";

export interface MonitorConnection {
  namespaceUri?: string;
  securityMode?: "None" | "Sign" | "SignAndEncrypt";
  securityPolicy?: "None" | "Basic256Sha256";
  certificateDirectory?: string;
  username?: string;
  password?: string;
}

export interface Sample {
  value: unknown;
  quality: string;
  good: boolean;
  sourceTimestamp?: string;
  serverTimestamp?: string;
  receivedAt: string;
}
export interface BrowseSession {
  browse: ClientSession["browse"];
  browseNext: ClientSession["browseNext"];
}
export async function discoverSymbols(
  session: BrowseSession,
  expected: Set<string>,
  namespace?: number,
) {
  const found = new Map<string, string>(),
    visited = new Set<string>();
  if (!expected.size) return found;
  const roots = new Set([...expected].map((symbol) => symbol.split(/\.|\[/, 1)[0]!));
  const prefixes = new Set<string>();
  for (const symbol of expected)
    for (let index = 1; index < symbol.length; index++)
      if (symbol[index] === "." || symbol[index] === "[") prefixes.add(symbol.slice(0, index));
  const unqualified = [...expected].some(
    (symbol) => !symbol.includes(".") && !symbol.includes("["),
  );
  const descend = (path: string, nodeClass: NodeClass) => {
    // CODESYS publishes large arrays as variable subtrees. Follow only branches
    // leading to requested qualified symbols rather than expanding every card.
    let offset = 0;
    while (offset < path.length) {
      const logical = path.slice(offset);
      if (roots.has(logical.split(/\.|\[/, 1)[0]!)) return prefixes.has(logical);
      const separator = path.indexOf(".", offset);
      if (separator < 0) break;
      offset = separator + 1;
    }
    return nodeClass === NodeClass.Object || unqualified;
  };
  const visit = async (nodeId: NodeIdLike, path: string, depth: number): Promise<void> => {
    const id = resolveNodeId(nodeId).toString();
    if (visited.has(id)) return;
    if (depth > 20 || visited.size >= 10_000)
      throw new Error("OPC-UA discovery exceeds 10,000 nodes or 20 levels.");
    visited.add(id);
    let result = await session.browse({
      nodeId: id,
      browseDirection: BrowseDirection.Forward,
      includeSubtypes: true,
      referenceTypeId: "HierarchicalReferences",
      resultMask: makeResultMask("NodeClass | BrowseName"),
    });
    try {
      while (true) {
        if (!result.statusCode.isGood())
          throw new Error(`Browse failed: ${result.statusCode.toString()}`);
        for (const reference of result.references ?? []) {
          const name = reference.browseName.name;
          if (!name || ["Server", "Types", "Aliases"].includes(name)) continue;
          const parent = path.slice(path.lastIndexOf(".") + 1);
          const child = name.startsWith(`${parent}[`) ? name.slice(parent.length) : name;
          const full = /^\[\d+\]$/.test(child)
            ? `${path}${child}`
            : [path, name].filter(Boolean).join(".");
          const node = reference.nodeId.toString();
          if (
            reference.nodeClass === NodeClass.Variable &&
            (namespace === undefined || reference.nodeId.namespace === namespace)
          ) {
            for (const symbol of expected)
              if (full === symbol || full.endsWith(`.${symbol}`)) {
                if (found.has(symbol) && found.get(symbol) !== node)
                  throw new Error(`Ambiguous OPC-UA symbol: ${symbol}`);
                found.set(symbol, node);
              }
          }
          if (
            (reference.nodeClass === NodeClass.Object ||
              reference.nodeClass === NodeClass.Variable) &&
            descend(full, reference.nodeClass)
          )
            await visit(node, full, depth + 1);
        }
        if (!result.continuationPoint?.length) break;
        result = await session.browseNext(result.continuationPoint, false);
      }
    } finally {
      if (result.continuationPoint?.length)
        await session.browseNext(result.continuationPoint, true);
    }
  };
  await visit(ObjectIds.ObjectsFolder, "", 0);
  return found;
}
export function sampleValue(value: DataValue): Sample {
  return {
    value: value.value.value,
    quality: value.statusCode.toString(),
    good: value.statusCode.isGood(),
    sourceTimestamp: value.sourceTimestamp?.toISOString(),
    serverTimestamp: value.serverTimestamp?.toISOString(),
    receivedAt: new Date().toISOString(),
  };
}

/** One read-only session owner. No Write, Call or controller state commands. */
export class Monitor {
  private client?: OPCUAClient;
  private session?: ClientSession;
  private subscription?: ClientSubscription;
  private generation = 0;
  private busy = false;
  readonly samples = new Map<string, Sample>();
  state = "Disconnected";
  constructor(private readonly change: () => void) {}
  async connect(endpoint: string, symbols: Set<string>, options: MonitorConnection = {}) {
    if (this.busy) throw new Error("A connection operation is in progress.");
    const mode = options.securityMode ?? "SignAndEncrypt";
    const policy = options.securityPolicy ?? (mode === "None" ? "None" : "Basic256Sha256");
    if ((mode === "None") !== (policy === "None"))
      throw new Error("None mode requires None policy; secure modes require Basic256Sha256.");
    if (mode === "None" && options.username)
      throw new Error("Username authentication requires a secure OPC-UA connection.");
    if (options.username && options.password === undefined)
      throw new Error(
        "Provide the configured OPC-UA user's password through the environment or SecretStorage.",
      );
    const [major, minor] = process.versions.node.split(".").map(Number);
    if (major! < 22 || (major === 22 && minor! < 13))
      throw new Error(
        "Live monitoring requires Node 22.13 or later in the VS Code extension host.",
      );
    this.busy = true;
    let generation = this.generation;
    try {
      await this.disconnect();
      generation = ++this.generation;
      this.state = "Connecting";
      this.change();
      const client = OPCUAClient.create({
        applicationName: "tsPLC",
        clientCertificateManager: new OPCUACertificateManager({
          rootFolder: resolve(options.certificateDirectory ?? ".tsplc/opcua-pki"),
          automaticallyAcceptUnknownCertificate: false,
        }),
        securityMode: MessageSecurityMode[mode],
        securityPolicy: SecurityPolicy[policy],
        endpointMustExist: false,
        connectionStrategy: { initialDelay: 500, maxDelay: 5000, maxRetry: 2 },
        requestedSessionTimeout: 60_000,
      });
      this.client = client;
      client.on("connection_lost", () => {
        if (this.generation === generation) {
          this.state = "Connection lost";
          this.change();
        }
      });
      client.on("start_reconnection", () => {
        if (this.generation === generation) {
          this.state = "Reconnecting";
          this.change();
        }
      });
      await client.connect(endpoint);
      if (this.generation !== generation) {
        await client.disconnect();
        return;
      }
      const session = await client.createSession(
        options.username
          ? {
              type: UserTokenType.UserName,
              userName: options.username,
              password: options.password!,
            }
          : { type: UserTokenType.Anonymous },
      );
      if (this.generation !== generation) {
        await session.close(true);
        await client.disconnect();
        return;
      }
      this.session = session;
      session.on("session_restored", () => {
        if (this.generation === generation) {
          this.state = "Connected";
          this.change();
        }
      });
      let namespace: number | undefined;
      if (options.namespaceUri) {
        const array = await session.read({
          nodeId: "Server_NamespaceArray",
          attributeId: AttributeIds.Value,
        });
        if (this.generation !== generation) return;
        if (!array.statusCode.isGood() || !Array.isArray(array.value.value))
          throw new Error("Cannot read the server namespace array.");
        namespace = array.value.value.indexOf(options.namespaceUri);
        if (namespace < 0) throw new Error(`Server has no namespace ${options.namespaceUri}.`);
      }
      const nodes = await discoverSymbols(session, symbols, namespace),
        watched = [...nodes];
      if (this.generation !== generation) return;
      for (const symbol of symbols)
        if (!nodes.has(symbol))
          this.samples.set(symbol, {
            value: null,
            quality: "Symbol not published",
            good: false,
            receivedAt: new Date().toISOString(),
          });
      if (watched.length) {
        const values = await session.read(
          watched.map(([, nodeId]) => ({ nodeId, attributeId: AttributeIds.Value })),
        );
        if (this.generation !== generation) return;
        values.forEach((value, index) => this.samples.set(watched[index]![0], sampleValue(value)));
        const subscription = await session.createSubscription2({
          requestedPublishingInterval: 500,
          requestedLifetimeCount: 120,
          requestedMaxKeepAliveCount: 10,
          maxNotificationsPerPublish: 200,
          publishingEnabled: true,
          priority: 0,
        });
        if (this.generation !== generation) {
          await subscription.terminate();
          return;
        }
        this.subscription = subscription;
        for (let offset = 0; offset < watched.length; offset += 100) {
          const batch = watched.slice(offset, offset + 100);
          const group = await subscription.monitorItems(
            batch.map(([, nodeId]) => ({ nodeId, attributeId: AttributeIds.Value })),
            { samplingInterval: 500, queueSize: 1, discardOldest: true },
            TimestampsToReturn.Both,
          );
          if (this.generation !== generation) return;
          group.on("changed", (_item, value, index) => {
            if (this.generation === generation) {
              this.samples.set(batch[index]![0], sampleValue(value));
              this.change();
            }
          });
          group.on("err", (error) => {
            if (this.generation === generation) {
              this.state = `Monitoring error: ${String(error)}`;
              this.change();
            }
          });
        }
      }
      this.state = "Connected";
      this.change();
    } catch (cause) {
      // A user disconnect or project refresh wins over an in-flight connect.
      // Its owned resources have already been released by disconnect().
      if (this.generation !== generation) return;
      await this.disconnect();
      this.state = `Connection failed: ${cause instanceof Error ? cause.message : String(cause)}`;
      this.change();
      throw cause;
    } finally {
      this.busy = false;
    }
  }
  async disconnect() {
    ++this.generation;
    const subscription = this.subscription,
      session = this.session,
      client = this.client;
    this.subscription = undefined;
    this.session = undefined;
    this.client = undefined;
    this.samples.clear();
    this.state = "Disconnected";
    this.change();
    for (const release of [
      () => subscription?.terminate(),
      () => session?.close(true),
      () => client?.disconnect(),
    ])
      try {
        await release();
      } catch {
        /* Continue releasing the other owned resources. */
      }
  }
}
