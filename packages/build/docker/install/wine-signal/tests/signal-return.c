#define _GNU_SOURCE
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ucontext.h>
#include <unistd.h>

static int normalize;

static void handler(int signal, siginfo_t *information, void *context)
{
    (void)signal;
    (void)information;
    unsigned char *state = (unsigned char *)((ucontext_t *)context)->uc_mcontext.fpregs;
    uint32_t magic, extended_size;
    uint64_t features;
    memcpy(&magic, state + 464, sizeof(magic));
    memcpy(&extended_size, state + 468, sizeof(extended_size));
    if (magic != 0x46505853 || extended_size < 832) _exit(77);
    memcpy(&features, state + 512, sizeof(features));
    if ((features & 7) != 7) _exit(78);
    features &= ~UINT64_C(4);
    memcpy(state + 512, &features, sizeof(features));
    if (normalize) {
        /* An absent AVX component requests its initial, all-zero YMM-high state.
           Store that state explicitly before marking the component present. */
        memset(state + 576, 0, 256);
        features |= 4;
        memcpy(state + 512, &features, sizeof(features));
    }
    ssize_t ignored = write(STDOUT_FILENO,
        normalize ? "Returning features 7\n" : "Returning features 3\n", 21);
    (void)ignored;
}

int main(int argc, char **argv)
{
    (void)argv;
    normalize = argc > 1;
    struct sigaction action = { .sa_sigaction = handler, .sa_flags = SA_SIGINFO };
    sigemptyset(&action.sa_mask);
    if (sigaction(SIGUSR1, &action, NULL) || raise(SIGUSR1)) return 1;
    puts("Signal returned: PASS");
    return 0;
}
