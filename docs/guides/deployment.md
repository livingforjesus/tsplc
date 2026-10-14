# Deploy and apply online changes

[Documentation home](../README.md) · [Build guide](building.md)

`build` produces artifacts. `run` installs them into a configured local Compose
runtime. `download` and `online-change` use a CODESYS gateway/controller
connection. Choose the operation that matches your target.

## A local Compose runtime

For an existing compatible runtime service, add:

```ts
build: {
  template: "templates/controller.project",
  outDir: "build/codesys",
  runtime: { composeFile: "compose.yaml", service: "plc" },
},
```

```sh
bun run tsplc run
```

This builds current source, validates the configured runtime storage, stops the
selected service, installs the application/CRC and starts that service. The
service needs writable named volumes or bind mounts at both
`/conf/codesyscontrol` and `/data/codesyscontrol`; an anonymous, readonly or tmpfs
mount is rejected. This setting selects an existing Compose runtime rather than
provisioning a device image.

## A gateway/controller connection

For download and online changes, configure `build.online`. This example uses
service names on a local Docker network; replace them with your deployment's
actual gateway and controller:

```ts
build: {
  template: "templates/controller.project",
  outDir: "build/codesys",
  symbols: true,
  online: {
    network: "machine_default",
    gateway: { host: "gateway", port: 1217 },
    device: { host: "plc", port: 11740 },
    credentials: {
      usernameEnv: "PLC_USERNAME",
      passwordEnv: "PLC_PASSWORD",
    },
  },
},
```

Provide these environment variables to the CLI. The config stores their names,
not credential values. This engineering connection is separate from the editor's
OPC UA `monitor` connection.

## Establish a baseline

```sh
bun run tsplc download --format json
bun run tsplc inspect --read Line.Infeed.Speed --format json
```

Download compiles/transfers the application, creates its boot application and
records a verified controller baseline. The receipt identifies the image,
template, target, application and code/data identities. `inspect` opens the saved
baseline and reads the controller without rebuilding source or resolving EDS and
library caches. `--read` accepts qualified IEC expressions and can be repeated.

The controller state is under `build.outDir/.codesys/controller`. Preserve it for
online changes; the ST output receipt alone is not an online baseline.

## Make an online change

Edit authored source, then run:

```sh
bun run tsplc online-change --format json
```

The command checks the saved baseline against the compiler image, template,
target and actual controller identities before applying a supported incremental
change. It updates the boot application and commits the new accepted baseline.
An image/template/target change or missing/mismatched baseline requires an
explicit fresh `download`; it is not silently converted into a full transfer.

If an update is acknowledged but worker shutdown subsequently fails, the command
reports failure and retains the accepted baseline. Inspect that state before
trying another operation. Do not discard a baseline merely to hide the failure.

`--initialize-user` is an explicit download option for a target that needs user
initialization. It is not part of the ordinary online-change workflow.

A virtual CODESYS application has been checked through download, online changes,
boot creation, restart and identity verification. This does not establish a
portable retention or arbitrary layout-change policy for every device. See
[validation](../validation.md) and [current reliability evidence](../build-reliability.md).
