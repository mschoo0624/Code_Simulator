#include <cstdio>
int main() {
    auto r = countBits(10);
    for (int x : r) std::printf("%d ", x);
    std::printf("\n");
    return 0;
}
