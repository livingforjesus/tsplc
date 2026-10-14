import { rawBuildConfig } from "@vplc/config/schema";
import type { IoChannel } from "@vplc/typegen/hardware";
import type { Sample } from "./monitor.ts";
import type { ProjectModel } from "./project-model.ts";

const entities: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escape(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => entities[character]!);
}

function valueCell(symbol?: string): string {
  if (!symbol) {
    return '<span class="muted" title="No published symbol mapping. Run vPLC typegen or configure monitor.symbols.">—</span>';
  }
  return `<span class="muted" data-symbol="${escape(symbol)}">—</span>`;
}

export function monitoredSymbols(project: ProjectModel): Set<string> {
  return new Set([
    ...Object.values(project.symbols),
    ...project.hardware.devices.flatMap((device) => Object.values(device.statusSymbols)),
    ...(project.config.monitor?.symbols ?? []),
  ]);
}

export interface HardwareUpdate {
  action: "samples";
  connection: string;
  samples: {
    symbol: string;
    text: string;
    title: string;
    state: "good" | "bad" | "stale";
  }[];
}

/** Keep transport values out of HTML; the webview applies these as text only. */
export function hardwareUpdate(
  state: string,
  samples: ReadonlyMap<string, Sample>,
): HardwareUpdate {
  const connected = state === "Connected";
  return {
    action: "samples",
    connection: state,
    samples: [...samples].map(([symbol, sample]) => {
      const value =
        typeof sample.value === "string" ||
        typeof sample.value === "bigint" ||
        typeof sample.value === "number"
          ? String(sample.value)
          : (JSON.stringify(sample.value, (_key, item) =>
              typeof item === "bigint" ? item.toString() : item,
            ) ?? "");
      return {
        symbol,
        text: sample.good ? `${value}${connected ? "" : " (stale)"}` : sample.quality,
        title: [
          sample.quality,
          `Received ${sample.receivedAt}`,
          `Source ${sample.sourceTimestamp ?? "unknown"}`,
          `Server ${sample.serverTimestamp ?? "unknown"}`,
          ...(connected ? [] : [state]),
        ].join("\n"),
        state: !sample.good ? "bad" : connected ? "good" : "stale",
      };
    }),
  };
}

interface PageOptions {
  nonce: string;
  scriptUri: string;
  styleUri: string;
  cspSource: string;
  relativePath: (path: string) => string;
  error?: string;
}

class ProjectRenderer {
  private readonly childrenByDevice = new Map<string, Map<string, IoChannel[]>>();

  constructor(private readonly project: ProjectModel) {
    for (const device of project.hardware.devices) {
      const children = new Map<string, IoChannel[]>();
      for (const channel of device.channels) {
        if (!channel.parent) continue;
        const siblings = children.get(channel.parent) ?? [];
        siblings.push(channel);
        children.set(channel.parent, siblings);
      }
      this.childrenByDevice.set(device.id, children);
    }
  }

  private symbol(name: string): string | undefined {
    return Object.hasOwn(this.project.symbols, name) ? this.project.symbols[name] : undefined;
  }

  private channelRow(device: string, channel: IoChannel, parent?: string): string {
    const mappings = Object.entries(this.project.config.io).filter(([, binding]) =>
      "device" in binding
        ? binding.device === device && binding.channel === channel.id
        : binding.address === channel.address,
    );
    const children = this.childrenByDevice.get(device)?.get(channel.id) ?? [];
    const key = `${device}:${channel.id}`;
    const toggle = children.length
      ? `<button class="bit-toggle" data-bit-toggle="${escape(key)}" aria-expanded="false" aria-label="Show bits for ${escape(channel.name)}">+</button>`
      : "";
    return `
      <tr${parent ? ` class="bit" data-parent="${escape(parent)}" hidden` : ""}>
        <td>${mappings.map(([name]) => escape(name)).join(", ") || '<span class="muted">Unmapped</span>'}</td>
        <td title="${escape(channel.id)}">${toggle}${escape(channel.name)}</td>
        <td>${escape(channel.address) || '<span class="muted">Unassigned</span>'}</td>
        <td>${escape(channel.type)}</td>
        <td>${mappings.map(([name]) => valueCell(this.symbol(name))).join(", ") || valueCell()}</td>
        <td>${escape(channel.unit)}</td>
        <td>${escape(channel.description)}</td>
      </tr>
      ${children.map((child) => this.channelRow(device, child, key)).join("")}`;
  }

  private direction(
    device: ProjectModel["hardware"]["devices"][number],
    direction: "input" | "output",
  ) {
    const channels = device.channels.filter(
      (channel) => channel.direction === direction && !channel.parent,
    );
    if (!channels.length) return "";
    return `
      <details open data-section="${escape(`${device.id}:${direction}`)}">
        <summary>${direction === "input" ? "Inputs" : "Outputs"}</summary>
        <div class="scroll">
          <table>
            <thead><tr><th>Variable</th><th>Channel</th><th>Address</th><th>Type</th><th>Value / quality</th><th>Unit</th><th>Description</th></tr></thead>
            <tbody>${channels.map((channel) => this.channelRow(device.id, channel)).join("")}</tbody>
          </table>
        </div>
      </details>`;
  }

  private assemblies(device: ProjectModel["hardware"]["devices"][number]): string {
    const connection = device.connection;
    const selection = connection
      ? `<p>Connection: ${escape(connection.id)} · ${escape(connection.name)}<br><small>EPATH: ${escape(connection.path)}</small></p>`
      : "<p>No EDS connection selected.</p>";
    if (!device.assemblies.length) return `${selection}<p>No assemblies selected.</p>`;
    return `
      ${selection}
      <div class="scroll"><table>
        <thead><tr><th>Direction</th><th>Assembly</th><th>Instance</th><th>Payload</th><th>EDS capacity</th><th>Address</th></tr></thead>
        <tbody>${device.assemblies
          .map(
            (assembly) =>
              `<tr><td>${assembly.direction === "input" ? "Input (device → PLC)" : "Output (PLC → device)"}</td><td>${escape(assembly.name)}</td><td>${assembly.instance}</td><td>${assembly.size} bytes</td><td>${assembly.capacity} bytes</td><td>${escape(assembly.address)}</td></tr>`,
          )
          .join("")}</tbody>
      </table></div>`;
  }

  devices(): string {
    return (
      this.project.hardware.devices
        .map((device) => {
          const descriptor = this.project.hardware.descriptors.find(
            (item) => item.file === device.descriptor,
          );
          const status = Object.entries(device.statusSymbols)
            .map(([label, symbol]) => `${escape(label)}: ${valueCell(symbol)}`)
            .join(" · ");
          return `
        <details open data-section="${escape(`device:${device.id}`)}">
          <summary>${escape(device.id)} · ${escape(descriptor?.name)}</summary>
          <p>${escape(descriptor?.vendor)} · ${escape(descriptor?.productCode)}</p>
          ${this.assemblies(device)}
          <p>${status || "Driver status unknown. Configure statusSymbols to expose diagnostics."}</p>
          ${this.direction(device, "input")}
          ${this.direction(device, "output")}
        </details>`;
        })
        .join("") ||
      "<p>No devices configured. Add EDS files and select devices in vplc.config.ts.</p>"
    );
  }

  directIo(): string {
    const rows = Object.entries(this.project.config.io)
      .filter(
        (entry): entry is [string, { address: string; type?: string }] => "address" in entry[1],
      )
      .map(
        ([symbol, binding]) => `
        <tr><td>${escape(symbol)}</td><td>${escape(binding.address)}</td><td>${valueCell(this.symbol(symbol))}</td></tr>`,
      )
      .join("");
    if (!rows) return "";
    return `
      <h2>Direct IO mapping</h2>
      <div class="scroll"><table>
        <thead><tr><th>Variable</th><th>Address</th><th>Value / quality</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  }

  watched(): string {
    const symbols = this.project.config.monitor?.symbols;
    if (!symbols?.length) return "";
    return `
      <h2>Watched symbols</h2>
      <table><thead><tr><th>Symbol</th><th>Value / quality</th></tr></thead>
        <tbody>${symbols.map((symbol) => `<tr><td>${escape(symbol)}</td><td>${valueCell(symbol)}</td></tr>`).join("")}</tbody>
      </table>`;
  }

  tasks(): string {
    const config = this.project.config;
    const build = config.build && !config.compiler ? rawBuildConfig(config) : undefined;
    const tasks = config.compiler
      ? config.tasks?.map((task) => ({
          name: task.name,
          intervalNanoseconds: task.schedule.interval.nanoseconds,
          priority: task.priority,
          programs: task.programs,
        }))
      : build?.tasks;
    const rows =
      tasks?.map((task) => ({
        name: task.name,
        cycle: `${Number(task.intervalNanoseconds) / 1_000_000} ms`,
        priority: String(task.priority),
        programs: task.programs,
      })) ??
      (build
        ? [
            {
              name: build.task ?? "MainTask",
              cycle: "Template",
              priority: "Template",
              programs: [`Entry: ${build.entry ?? "src/Main.st"}`],
            },
          ]
        : []);
    if (!rows.length) return "<h2>Tasks</h2><p>No task plan configured.</p>";
    return `
      <h2>Tasks</h2>
      <div class="scroll"><table>
        <thead><tr><th>Task</th><th>Cycle</th><th>Priority</th><th>Calls / entry source</th></tr></thead>
        <tbody>${rows.map((task) => `<tr><td>${escape(task.name)}</td><td>${escape(task.cycle)}</td><td>${escape(task.priority)}</td><td>${escape(task.programs.join(" → "))}</td></tr>`).join("")}</tbody>
      </table></div>
      ${build && !tasks ? '<p class="muted">The PROGRAM is read from the entry source. Task cycle and priority come from the configured CODESYS template.</p>' : ""}`;
  }
}

export function hardwarePage(project: ProjectModel | undefined, options: PageOptions): string {
  const renderer = project && new ProjectRenderer(project);
  const descriptors =
    project?.hardware.descriptors
      .map(
        (descriptor) => `
    <li>${escape(descriptor.name)} · ${escape(descriptor.vendor)} · ${descriptor.assemblies.length} assemblies
      <small>${escape(options.relativePath(descriptor.file))}</small>
    </li>`,
      )
      .join("") || "<li>No descriptions found</li>";
  return `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${escape(options.cspSource)}; script-src 'nonce-${escape(options.nonce)}';">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="stylesheet" href="${escape(options.styleUri)}">
        <title>vPLC hardware &amp; IO</title>
      </head>
      <body data-project="${escape(project?.configFile)}">
        <h1>${escape(project?.name ?? "vPLC hardware & IO")}</h1>
        <nav aria-label="Project commands">
          <button data-action="refresh">Refresh</button>
          <button data-action="select">Project</button>
          <button data-action="config">Config</button>
          <button data-action="typegen">Generate types</button>
          <button data-action="connect">Connect</button>
          <button data-action="disconnect">Disconnect</button>
          ${project?.config.monitor?.username && !project.config.monitor.passwordEnv ? '<button data-action="forgetPassword">Forget password</button>' : ""}
        </nav>
        ${options.error ? `<p class="bad" role="alert">${escape(options.error)}</p>` : ""}
        <p class="connection"><span id="connection-status" role="status">Disconnected</span> · ${escape(project?.config.monitor?.endpoint ?? "No monitoring endpoint configured")}</p>
        ${project?.config.monitor ? `<p class="muted">${escape(project.config.monitor.securityMode)} · ${escape(project.config.monitor.securityPolicy)} · ${escape(project.config.monitor.username ?? "Anonymous")}<br>Certificate trust: ${escape(project.config.monitor.certificateDirectory)}. Verify and trust the PLC certificate before connecting.</p>` : ""}
        ${
          project && renderer
            ? `
          <p class="muted">${escape(options.relativePath(project.configFile))} · ${project.source === "generated" ? "Generated config snapshot" : "Config"}</p>
          ${renderer.devices()}
          ${renderer.directIo()}
          ${renderer.watched()}
          ${renderer.tasks()}
          <details data-section="descriptions"><summary>Hardware descriptions</summary><ul>${descriptors}</ul></details>`
            : "<p>Add a vplc.config.ts to your workspace.</p>"
        }
        <script nonce="${escape(options.nonce)}" src="${escape(options.scriptUri)}"></script>
      </body>
    </html>`;
}
