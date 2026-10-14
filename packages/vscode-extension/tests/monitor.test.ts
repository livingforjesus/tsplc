import { expect, spyOn, test } from "bun:test";
import { EventEmitter } from "node:events";
import {
  DataValue,
  MessageSecurityMode,
  NodeClass,
  OPCUAClient,
  resolveNodeId,
  SecurityPolicy,
  StatusCodes,
  UserTokenType,
  type ClientSession,
} from "node-opcua-client";
import { discoverSymbols, Monitor, sampleValue } from "../src/monitor.ts";

test("the monitor encrypts authenticated sessions and does not auto-trust server certificates", async () => {
  let identity: unknown;
  const session = Object.assign(new EventEmitter(), { close: async () => {} });
  const client = Object.assign(new EventEmitter(), {
    connect: async () => {},
    disconnect: async () => {},
    createSession: async (credentials: unknown) => {
      identity = credentials;
      return session as unknown as ClientSession;
    },
  });
  const create = spyOn(OPCUAClient, "create").mockReturnValue(client as unknown as OPCUAClient);
  const monitor = new Monitor(() => {});
  try {
    await monitor.connect("opc.tcp://synthetic.test:4840", new Set(), {
      username: "operator",
      password: "synthetic-password",
    });
    const options = create.mock.calls[0]![0]!;
    expect(options.securityMode).toBe(MessageSecurityMode.SignAndEncrypt);
    expect(options.securityPolicy).toBe(SecurityPolicy.Basic256Sha256);
    expect(
      (options.clientCertificateManager as { automaticallyAcceptUnknownCertificate: boolean })
        .automaticallyAcceptUnknownCertificate,
    ).toBe(false);
    expect(identity).toEqual({
      type: UserTokenType.UserName,
      userName: "operator",
      password: "synthetic-password",
    });
    await expect(
      monitor.connect("opc.tcp://synthetic.test:4840", new Set(), {
        username: "operator",
        securityMode: "None",
        password: "synthetic-password",
      }),
    ).rejects.toThrow("secure");
    expect(create.mock.calls.length).toBe(1);
  } finally {
    await monitor.disconnect();
    create.mockRestore();
  }
});

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

test("an empty monitor selection does not traverse the server address space", async () => {
  const nodes = await discoverSymbols(
    {
      browse: async () => {
        throw new Error("unexpected browse");
      },
      browseNext: async () => {
        throw new Error("unexpected browseNext");
      },
    } as Parameters<typeof discoverSymbols>[0],
    new Set(),
  );
  expect(nodes.size).toBe(0);
});

test("discovery resolves CODESYS array children and consumes browse continuation points", async () => {
  const reference = (name: string, id: string, nodeClass: NodeClass, namespace = 2) => ({
    browseName: { name },
    nodeId: resolveNodeId(`ns=${namespace};s=${id}`),
    nodeClass,
  });
  const page = (references: ReturnType<typeof reference>[], continuationPoint?: Buffer) => ({
    references,
    continuationPoint,
    statusCode: StatusCodes.Good,
  });
  const graph = new Map([
    ["ns=0;i=85", page([reference("Application", "app", NodeClass.Object)], Buffer.from("page2"))],
    ["ns=2;s=app", page([reference("GVL_IO", "io", NodeClass.Object)])],
    [
      "ns=2;s=io",
      page([
        reference("Zones", "zones", NodeClass.Variable),
        reference("UnrelatedHugeArray", "unrelated", NodeClass.Variable),
      ]),
    ],
    ["ns=2;s=zones", page([reference("Zones[1]", "zone", NodeClass.Variable)])],
    ["ns=2;s=zone", page([reference("Output", "output", NodeClass.Variable)])],
    ["ns=2;s=output", page([reference("Asserted", "asserted", NodeClass.Variable)])],
  ]);
  const continuations: boolean[] = [];
  const session = {
    browse: async ({ nodeId }: { nodeId: string }) => {
      if (nodeId === "ns=2;s=unrelated")
        throw new Error("The monitor expanded an unrelated array.");
      return graph.get(nodeId) ?? page([]);
    },
    browseNext: async (_point: Buffer, release: boolean) => {
      continuations.push(release);
      return page([reference("GVL_IO.Unbound", "other", NodeClass.Variable, 3)]);
    },
  } as unknown as Parameters<typeof discoverSymbols>[0];
  const found = await discoverSymbols(
    session,
    new Set(["GVL_IO.Zones[1].Output.Asserted", "GVL_IO.Unbound"]),
    2,
  );
  expect(found.get("GVL_IO.Zones[1].Output.Asserted")).toBe("ns=2;s=asserted");
  expect(found.has("GVL_IO.Unbound")).toBe(false);
  expect(continuations).toEqual([false]);
});

test("a failed browse releases its outstanding continuation point", async () => {
  const released: boolean[] = [];
  const session = {
    browse: async () => ({
      statusCode: StatusCodes.BadCommunicationError,
      references: [],
      continuationPoint: Buffer.from("pending"),
    }),
    browseNext: async (_point: Buffer, release: boolean) => {
      released.push(release);
      return { statusCode: StatusCodes.Good, references: [] };
    },
  } as unknown as Parameters<typeof discoverSymbols>[0];
  await expect(discoverSymbols(session, new Set(["GVL_IO.Start"]))).rejects.toThrow(
    "Browse failed",
  );
  expect(released).toEqual([true]);
});

test("monitor samples preserve status and source timestamps without inventing freshness", () => {
  const sample = sampleValue(
    new DataValue({
      sourceTimestamp: new Date("2020-01-01T00:00:00.000Z"),
      statusCode: StatusCodes.BadCommunicationError,
    }),
  );
  expect(sample.good).toBe(false);
  expect(sample.quality).toContain("BadCommunicationError");
  expect(sample.sourceTimestamp).toBe("2020-01-01T00:00:00.000Z");
  expect(sample.receivedAt).toBeDefined();
});

test.each(["connect", "session"])(
  "disconnect during pending %s cannot resurrect the monitor",
  async (phase) => {
    const pending = deferred();
    const reached = deferred();
    let sessions = 0;
    let closes = 0;
    let disconnects = 0;
    const session = Object.assign(new EventEmitter(), {
      close: async () => {
        closes++;
      },
      browse: async () => {
        throw new Error("unexpected browse");
      },
      browseNext: async () => {
        throw new Error("unexpected browseNext");
      },
    });
    const client = Object.assign(new EventEmitter(), {
      connect: async () => {
        if (phase === "connect") {
          reached.release();
          await pending.promise;
        }
      },
      createSession: async () => {
        sessions++;
        if (phase === "session") {
          reached.release();
          await pending.promise;
        }
        return session as unknown as ClientSession;
      },
      disconnect: async () => {
        disconnects++;
      },
    });
    const create = spyOn(OPCUAClient, "create").mockReturnValue(client as unknown as OPCUAClient);
    try {
      const monitor = new Monitor(() => {});
      const connecting = monitor.connect("opc.tcp://synthetic.test:4840", new Set());
      await reached.promise;
      await monitor.disconnect();
      pending.release();
      await connecting;
      expect(monitor.state).toBe("Disconnected");
      expect(monitor.samples.size).toBe(0);
      expect(disconnects).toBeGreaterThanOrEqual(1);
      expect(sessions).toBe(phase === "session" ? 1 : 0);
      expect(closes).toBe(phase === "session" ? 1 : 0);
    } finally {
      pending.release();
      create.mockRestore();
    }
  },
);
