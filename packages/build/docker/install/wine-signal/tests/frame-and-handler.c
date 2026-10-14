#include "../signal-state.c"
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include <sys/mman.h>

static int calls;
static uint64_t desired_features;
static void *replacement;
static void original(int signal, siginfo_t *information, void *pointer)
{
    (void)information;
    assert(signal == SIGUSR1);
    ++calls;
    ucontext_t *context = pointer;
    if (replacement) context->uc_mcontext.fpregs = replacement;
    if (context->uc_mcontext.fpregs)
        ((struct signal_xstate *)context->uc_mcontext.fpregs)->features = desired_features;
}
static void different(int signal, siginfo_t *information, void *pointer)
{
    (void)signal;
    (void)information;
    (void)pointer;
}
static void simple(int signal)
{
    (void)signal;
}

static struct signal_xstate frame(void)
{
    struct signal_xstate value;
    memset(&value, 0xa5, sizeof(value));
    value.magic = 0x46505853;
    value.extended_size = 836;
    value.supported_features = 7;
    value.xstate_size = 832;
    value.features = 7;
    value.header_reserved[0] = 0x6e6769732d656e69;
    /* Observed unused Rosetta header data. */
    value.end_magic = 0x46505845;
    return value;
}
static void invoke(struct signal_xstate *value)
{
    ucontext_t context = {0};
    context.uc_mcontext.fpregs = (void *)value;
    struct sigaction kernel;
    assert(!next_sigaction(SIGUSR1, NULL, &kernel));
    kernel.sa_sigaction(SIGUSR1, NULL, &context);
}
static int cases;
static void expect_unchanged(struct signal_xstate value)
{
    struct signal_xstate expected = value;
    expected.features = desired_features;
    invoke(&value);
    assert(!memcmp(&value, &expected, sizeof(value)));
    ++cases;
}

int main(void)
{
    struct sigaction action = {
        .sa_sigaction = original,
        .sa_flags = SA_SIGINFO | SA_RESTART | SA_ONSTACK
    };
    sigemptyset(&action.sa_mask);
    sigaddset(&action.sa_mask, SIGUSR2);
    struct sigaction before, query;
    assert(!sigaction(SIGUSR1, &action, &before));
    assert(!sigaction(SIGUSR1, NULL, &query));
    assert(query.sa_sigaction == original);
    assert((query.sa_flags & (SA_SIGINFO | SA_RESTART | SA_ONSTACK)) == action.sa_flags);
    assert(sigismember(&query.sa_mask, SIGUSR2));
    ++cases;

    desired_features = 3;
    struct signal_xstate value = frame(), expected = value;
    memset(expected.ymm_high, 0, sizeof(expected.ymm_high));
    invoke(&value);
    assert(!memcmp(&value, &expected, sizeof(value)));
    ++cases;

    desired_features = 7;
    expect_unchanged(frame());
    /* Nonzero AVX state remains intact. */
    desired_features = 3;
    value = frame();
    value.features = 3;
    expect_unchanged(value);
    value = frame();
    value.magic = 0;
    expect_unchanged(value);
    value = frame();
    value.extended_size = 835;
    expect_unchanged(value);
    value = frame();
    value.extended_size = 840;
    expect_unchanged(value);
    value = frame();
    value.xstate_size = 831;
    expect_unchanged(value);
    value = frame();
    value.supported_features = 15;
    expect_unchanged(value);
    value = frame();
    value.header_reserved[0] = UINT64_C(1) << 63;
    expected = value;
    memset(expected.ymm_high,0, sizeof(expected.ymm_high));
    invoke(&value);
    assert(!memcmp(&value, &expected, sizeof(value)));
    ++cases;
    value = frame();
    value.end_magic = 0;
    expect_unchanged(value);
    desired_features = 1;
    expect_unchanged(frame());
    desired_features = 5;
    expect_unchanged(frame());
    desired_features = 15;
    expect_unchanged(frame());
    desired_features = 3;
    invoke(NULL);
    ++cases;

    value = frame();
    struct signal_xstate second = frame();
    expected = second;
    memset(expected.ymm_high, 0, sizeof(expected.ymm_high));
    replacement = &second;
    invoke(&value);
    struct signal_xstate unchanged = frame();
    assert(!memcmp(&value, &unchanged, sizeof(value)));
    assert(!memcmp(&second, &expected, sizeof(second)));
    replacement = NULL;
    ++cases;

    /* The legacy header can end at a protected page boundary. No extended
       access is permitted after missing magic. */
    long page = sysconf(_SC_PAGESIZE);
    void *memory = mmap(NULL, (size_t)page * 2, PROT_READ | PROT_WRITE,
                      MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    assert(memory != MAP_FAILED);
    assert(!mprotect((char *)memory + page,(size_t)page, PROT_NONE));
    unsigned char *legacy = (unsigned char *)memory + page - 512;
    memset(legacy, 0, 512);
    ucontext_t context = {0};
    context.uc_mcontext.fpregs = (void *)legacy;
    assert(valid_state(&context) == NULL);
    munmap(memory,(size_t)page * 2);
    ++cases;

    struct sigaction changed = {.sa_sigaction = different, .sa_flags = SA_SIGINFO};
    sigemptyset(&changed.sa_mask);
    assert(!sigaction(SIGUSR1, &changed, &query));
    assert(query.sa_sigaction == original);
    assert(!next_sigaction(SIGUSR1, NULL, &query));
    assert(query.sa_sigaction == different);
    ++cases;
    assert(!sigaction(SIGUSR1, &action, &query));
    assert(query.sa_sigaction == different);
    ++cases;
    struct sigaction ignored = {.sa_handler = SIG_IGN};
    sigemptyset(&ignored.sa_mask);
    assert(!sigaction(SIGUSR1, &ignored, &query));
    assert(query.sa_sigaction == original);
    assert(!sigaction(SIGUSR1, NULL, &query));
    assert(query.sa_handler == SIG_IGN);
    ++cases;
    struct sigaction defaults = {.sa_handler = SIG_DFL};
    sigemptyset(&defaults.sa_mask);
    assert(!sigaction(SIGUSR1, &defaults, &query));
    assert(query.sa_handler == SIG_IGN);
    assert(!sigaction(SIGUSR1, NULL, &query));
    assert(query.sa_handler == SIG_DFL);
    ++cases;
    struct sigaction one = {.sa_handler = simple};
    sigemptyset(&one.sa_mask);
    assert(!sigaction(SIGUSR1, &one, &query));
    assert(query.sa_handler == SIG_DFL);
    assert(!next_sigaction(SIGUSR1, NULL, &query));
    assert(query.sa_handler == simple);
    ++cases;
    assert(!sigaction(SIGUSR2, &action, NULL));
    assert(!next_sigaction(SIGUSR2, NULL, &query));
    assert(query.sa_sigaction == original);
    ++cases;
    printf("Signal adapter semantics: %d cases PASS (%d original callbacks)\n", cases, calls);
    return 0;
}
