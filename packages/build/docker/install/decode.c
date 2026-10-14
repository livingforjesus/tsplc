#include <stddef.h>

/* InstallShield swaps each byte's nibbles, XORs the name-derived key byte,
   then inverts the bits. The repeated key sequence restarts every 1024 bytes. */
void decode(unsigned char *data, size_t data_length, const unsigned char *key, size_t key_length) {
    for (size_t index = 0; index < data_length; index++) {
        const unsigned char byte = data[index];
        const unsigned char swapped_nibbles = (unsigned char)((byte << 4) | (byte >> 4));
        const unsigned char key_byte = key[(index % 1024) % key_length];
        data[index] = (unsigned char)~(key_byte ^ swapped_nibbles);
    }
}
