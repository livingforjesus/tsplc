/* A minimal dynamic i386 executable: its loader must expand LD_PRELOAD
   correctly, then this entry point exits without depending on 32-bit libc. */
__attribute__((noreturn)) void _start(void)
{
    __asm__ volatile("movl $1, %%eax\n\txorl %%ebx, %%ebx\n\tint $0x80"
                     : : : "eax", "ebx", "memory");
    __builtin_unreachable();
}
