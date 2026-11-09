#include <stdlib.h>
int* countBits(int n, int* returnSize) {
    int* dp = malloc(sizeof(int) * (n + 1));
    *returnSize = n + 1;
    dp[0] = 0;
    for (int i = 1; i <= n; i++)
        dp[i] = (i & 1) + dp[i / 2];
    return dp;
}
