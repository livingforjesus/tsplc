#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <signal.h>
#include <stdatomic.h>
#include <stddef.h>
#include <stdint.h>
#include <ucontext.h>
#include <unistd.h>

/* Linux's standard, uncompacted XSAVE layout for x87, SSE and AVX only.
   Restrict the adapter to the exact frame produced by the tested Rosetta ABI. */
struct __attribute__((may_alias)) signal_xstate {
    unsigned char legacy[464];
    uint32_t magic;
    uint32_t extended_size;
    uint64_t supported_features;
    uint32_t xstate_size;
    uint32_t software_reserved[7];
    uint64_t features;
    uint64_t header_reserved[7];
    unsigned char ymm_high[256];
    uint32_t end_magic;
};
_Static_assert(offsetof(struct signal_xstate, features) == 512, "XSAVE header offset");
_Static_assert(offsetof(struct signal_xstate, ymm_high) == 576, "AVX component offset");
_Static_assert(offsetof(struct signal_xstate, end_magic) == 832, "Linux XSAVE tail offset");

typedef void (*signal_handler)(int, siginfo_t *, void *);
typedef int (*sigaction_function)(int, const struct sigaction *, struct sigaction *);
static sigaction_function next_sigaction;
static _Atomic(signal_handler) usr1_handler;
_Static_assert(ATOMIC_POINTER_LOCK_FREE == 2, "Handler loads must be signal-safe");

static struct signal_xstate *valid_state(ucontext_t *context)
{
    struct signal_xstate *state = (void *)context->uc_mcontext.fpregs;
    if (!state || state->magic != UINT32_C(0x46505853)) return NULL;
    /* Check lengths before accessing the extended header, component or tail. */
    if (state->extended_size != 836 || state->xstate_size != 832 ||
        state->supported_features != 7) return NULL;
    /* The Linux public signal ABI reserves all other header words. Rosetta
       leaves some uninitialized; preserve them rather than infer a format. */
    if (state->end_magic != UINT32_C(0x46505845)) return NULL;
    return state;
}

static void dispatch_usr1(int signal, siginfo_t *information, void *pointer)
{
    ucontext_t *context = pointer;
    struct signal_xstate *entry = context ? valid_state(context) : NULL;
    int full_state_on_entry = entry && entry->features == 7;
    signal_handler handler = atomic_load_explicit(&usr1_handler, memory_order_acquire);
    handler(signal, information, pointer);
    /* Wine may replace fpregs; revalidate the returned frame rather than retain
       the old pointer. An absent AVX component means all YMM-high bits are zero.
       Store that same architectural state explicitly for Rosetta's sigreturn. */
    struct signal_xstate *returned = context && full_state_on_entry ? valid_state(context) : NULL;
    if (returned && returned->features == 3) {
        volatile unsigned char *ymm = returned->ymm_high;
        for (size_t index = 0; index < sizeof(returned->ymm_high); ++index) ymm[index] = 0;
        returned->features = 7;
    }
}

__attribute__((constructor)) static void resolve_sigaction(void)
{
    next_sigaction = (sigaction_function)dlsym(RTLD_NEXT, "sigaction");
    if (!next_sigaction) {
        const char message[] = "Wine signal adapter: cannot resolve libc sigaction\n";
        ssize_t ignored = write(STDERR_FILENO, message, sizeof(message) - 1);
        (void)ignored;
        _exit(127);
    }
}

int sigaction(int signal, const struct sigaction *action, struct sigaction *old_action)
{
    if (signal != SIGUSR1) return next_sigaction(signal, action, old_action);
    struct sigaction wrapped;
    const struct sigaction *installed = action;
    int siginfo_handler = action && (action->sa_flags & SA_SIGINFO) &&
                          action->sa_handler != SIG_DFL && action->sa_handler != SIG_IGN;
    if (siginfo_handler) {
        /* Wine installs one process-wide usr1_handler. Bind it once, so a
           concurrently replaced disposition cannot redirect an active wrapper.
           A different application's replacement handler goes directly to libc. */
        signal_handler expected = NULL;
        atomic_compare_exchange_strong_explicit(&usr1_handler, &expected, action->sa_sigaction,
                                                memory_order_acq_rel, memory_order_acquire);
        signal_handler bound = atomic_load_explicit(&usr1_handler, memory_order_acquire);
        if (bound == action->sa_sigaction) {
            wrapped = *action;
            wrapped.sa_sigaction = dispatch_usr1;
            installed = &wrapped;
        }
    }
    int result = next_sigaction(signal, installed, old_action);
    int saved_errno = errno;
    if (!result && old_action && (old_action->sa_flags & SA_SIGINFO) &&
        old_action->sa_sigaction == dispatch_usr1)
        old_action->sa_sigaction = atomic_load_explicit(&usr1_handler, memory_order_acquire);
    errno = saved_errno;
    return result;
}
