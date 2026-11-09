#include <stdio.h>
int main(void) {
    printf("%d\n", crash((int*)0));
    return 0;
}
