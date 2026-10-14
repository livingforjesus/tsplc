# Wine signal-state adapter

Wine 11.19 can clear AVX presence during SIGUSR1 suspend/resume when the returned YMM-high registers are zero. Rosetta's Linux signal return requires all three advertised x87/SSE/AVX components to remain present. A native reproducer returns exit 133 with the same `ThreadContextSignals.cpp:414` assertion; an explicit zero AVX component returns successfully. Ten actual Frame cold builds passed with this adapter after the fresh image and the NGen-drained control reproduced the fault.

The adapter wraps Wine's single `SA_SIGINFO` SIGUSR1 handler. For the validated Linux layout (magic words, 832-byte state, 836-byte extended area and layout features 7), it changes only entry features 7 → returned features 3: zero the 256 YMM-high bytes and mark AVX present. Absent AVX already means that same zero architectural state. Legacy registers, existing nonzero AVX, other transitions and reserved fields remain untouched. The returned frame pointer is revalidated.

The original handler is bound immutably before registration, so concurrent disposition changes cannot redirect an active wrapper. Other handlers are delegated; masks, flags, queries, default and ignore are preserved. This is scoped to Wine's successful registration after loader initialization: the shipped Wine executables depend only on libc and register with `old_action = NULL`, aborting on failure. It is not a generic preload for arbitrary dependency constructors.

The launcher sets `LD_PRELOAD` only while executing Wine. Ubuntu's `$LIB` expansion selects the AMD64 adapter or an empty i386 library, including child processes. Setup under FEX does not use this launcher. Vendor binaries and their status/result checks are unchanged.

## Native checks

Run `check.sh` inside AMD64 Ubuntu Linux with GCC, libc development headers, Python, the i386 loader and AVX support. The Docker recipe's `wine-signal-compat` stage has these tools. The fixtures check 23 frame/handler cases, real signal return, zero/nonzero AVX register preservation, and both actual loader-expanded paths without warnings. No generated binaries are maintained. The command prints its temporary artifact directory and retains failure logs; a disposable container owns cleanup.

```sh
docker build --platform linux/amd64 --target wine-signal-compat \
  -f packages/build/docker/Dockerfile -t vplc-wine-signal-check packages/build
docker run --rm --platform linux/amd64 --entrypoint /bin/sh \
  vplc-wine-signal-check /opt/codesys-install/wine-signal/check.sh
```

The exact ABI and Wine mechanism are documented in the primary [Linux signal ABI](https://github.com/torvalds/linux/blob/v6.17/arch/x86/include/uapi/asm/sigcontext.h), [Linux signal restore](https://github.com/torvalds/linux/blob/v6.17/arch/x86/kernel/fpu/signal.c), and [Wine 11.19 suspend/resume state conversion](https://github.com/wine-mirror/wine/blob/wine-11.19/dlls/ntdll/unix/thread.c). The completed-log native assertion guard still rejects any remaining helper fault, even if the main launcher reports zero.
