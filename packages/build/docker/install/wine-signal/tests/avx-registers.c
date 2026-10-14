#define _GNU_SOURCE
#include <assert.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/syscall.h>
#include <ucontext.h>
#include <unistd.h>

static int preserve_nonzero;

static void handler(int signal, siginfo_t *information, void *pointer)
{
    (void)signal;
    (void)information;
    unsigned char *state = (void *)((ucontext_t *)pointer)->uc_mcontext.fpregs;
    uint64_t features;
    memcpy(&features, state + 512, sizeof(features));
    if ((features & 7) != 7) _exit(78);
    if (preserve_nonzero) {
        memset(state + 576, 0x3c, 256);
    } else {
        features &= ~UINT64_C(4);
        memcpy(state + 512, &features, sizeof(features));
    }
}

int main(int argc, char **argv)
{
    (void)argv;
    preserve_nonzero = argc > 1;
    struct sigaction action = {.sa_sigaction = handler, .sa_flags = SA_SIGINFO};
    sigemptyset(&action.sa_mask);
    assert(!sigaction(SIGUSR1, &action, NULL));
    unsigned char seed[32], returned[32];
    memset(seed, 0x19, 16);
    memset(seed + 16, 0x29, 16);
    long process = getpid(), thread = syscall(SYS_gettid), number = SYS_tgkill;
    /* Do not call a libc function between loading and reading YMM0: the SysV
       calling convention would allow it to destroy the vector register. */
    __asm__ volatile("vmovdqu %2, %%ymm0\n\tsyscall\n\tvmovdqu %%ymm0, %0"
        : "=m"(returned), "+a"(number)
        : "m"(seed), "D"(process), "S"(thread), "d"((long)SIGUSR1)
        : "rcx", "r11", "memory", "ymm0");
    assert(number == 0);
    for (int index = 0; index < 16; ++index) assert(returned[index] == 0x19);
    for (int index = 16; index < 32; ++index)
        assert(returned[index] == (preserve_nonzero ? 0x3c : 0));
    printf("Real AVX register return: %s PASS\n",
           preserve_nonzero ? "nonzero preserved" : "absent component initialized");
    return 0;
}
