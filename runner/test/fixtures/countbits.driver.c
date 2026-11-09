#include <stdio.h>
int main(void) {
    int size;
    int* r = countBits(10, &size);
    for (int i = 0; i < size; i++) printf("%d ", r[i]);
    printf("\n");
    free(r);
    return 0;
}
