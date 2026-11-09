export interface Preset {
  id: string;
  label: string;
  language: "c" | "cpp";
  solution: string;
  driver: string;
}

/** Blank starting points for writing ANY custom C/C++ code. */
export const customTemplates: Preset[] = [
  {
    id: "custom-c",
    label: "Custom code (C)",
    language: "c",
    solution: `/* Write ANY C code here: arrays, pointers, structs, linked lists,
   trees, recursion, malloc/free... The visualizer traces the real
   execution and automatically picks a fitting illustration. */

int solve(int* a, int n) {
    int sum = 0;
    for (int i = 0; i < n; i++) {
        sum += a[i];
    }
    return sum;
}
`,
    driver: `#include <stdio.h>
#include <stdlib.h>

/* Call your function from main(). Only lines in the Solution pane
   are traced and illustrated; this driver runs silently. */
int main(void) {
    int n = 5;
    int* a = malloc(sizeof(int) * n);
    for (int i = 0; i < n; i++) a[i] = i + 1;
    printf("%d\\n", solve(a, n));
    free(a);
    return 0;
}
`,
  },
  {
    id: "custom-cpp",
    label: "Custom code (C++)",
    language: "cpp",
    solution: `// Write ANY C++ code here: std::vector, std::string, structs,
// recursion, pointers... The visualizer traces the real execution
// and automatically picks a fitting illustration.
#include <vector>
using namespace std;

int solve(const vector<int>& a) {
    int sum = 0;
    for (int i = 0; i < (int)a.size(); i++) {
        sum += a[i];
    }
    return sum;
}
`,
    driver: `#include <cstdio>
#include <vector>

// Call your function from main(). Only lines in the Solution pane
// are traced and illustrated; this driver runs silently.
int main() {
    std::vector<int> a = {1, 2, 3, 4, 5};
    std::printf("%d\\n", solve(a));
    return 0;
}
`,
  },
];

export const presets: Preset[] = [
  {
    id: "countbits-c",
    label: "Counting Bits (C)",
    language: "c",
    solution: `#include <stdlib.h>
int* countBits(int n, int* returnSize) {
    int* dp = malloc(sizeof(int) * (n + 1));
    *returnSize = n + 1;
    dp[0] = 0;
    for (int i = 1; i <= n; i++)
        dp[i] = (i & 1) + dp[i / 2];
    return dp;
}
`,
    driver: `#include <stdio.h>
int main(void) {
    int size;
    int* r = countBits(10, &size);
    for (int i = 0; i < size; i++) printf("%d ", r[i]);
    printf("\\n");
    free(r);
    return 0;
}
`,
  },
  {
    id: "countbits-cpp",
    label: "Counting Bits (C++ vector)",
    language: "cpp",
    solution: `#include <vector>
using namespace std;
vector<int> countBits(int n) {
    vector<int> dp(n + 1);
    for (int i = 1; i <= n; i++)
        dp[i] = dp[i >> 1] + (i & 1);
    return dp;
}
`,
    driver: `#include <cstdio>
int main() {
    auto r = countBits(10);
    for (int x : r) std::printf("%d ", x);
    std::printf("\\n");
    return 0;
}
`,
  },
  {
    id: "binary-search-c",
    label: "Binary Search (C)",
    language: "c",
    solution: `int search(int* nums, int numsSize, int target) {
    int left = 0;
    int right = numsSize - 1;
    while (left <= right) {
        int mid = left + (right - left) / 2;
        if (nums[mid] == target) return mid;
        if (nums[mid] < target) left = mid + 1;
        else right = mid - 1;
    }
    return -1;
}
`,
    driver: `#include <stdio.h>
#include <stdlib.h>
int main(void) {
    int vals[] = {-8, -1, 0, 3, 5, 9, 12, 40};
    int n = 8;
    int* nums = malloc(sizeof(int) * n);
    for (int i = 0; i < n; i++) nums[i] = vals[i];
    printf("%d\\n", search(nums, n, 9));
    free(nums);
    return 0;
}
`,
  },
  {
    id: "bubble-sort-c",
    label: "Bubble Sort (C)",
    language: "c",
    solution: `void bubbleSort(int* a, int n) {
    for (int i = 0; i < n - 1; i++) {
        for (int j = 0; j < n - 1 - i; j++) {
            if (a[j] > a[j + 1]) {
                int tmp = a[j];
                a[j] = a[j + 1];
                a[j + 1] = tmp;
            }
        }
    }
}
`,
    driver: `#include <stdio.h>
#include <stdlib.h>
int main(void) {
    int vals[] = {5, 1, 4, 2, 8};
    int n = 5;
    int* a = malloc(sizeof(int) * n);
    for (int i = 0; i < n; i++) a[i] = vals[i];
    bubbleSort(a, n);
    for (int i = 0; i < n; i++) printf("%d ", a[i]);
    printf("\\n");
    free(a);
    return 0;
}
`,
  },
  {
    id: "reverse-list-c",
    label: "Reverse Linked List (C)",
    language: "c",
    solution: `struct Node {
    int val;
    struct Node* next;
};

struct Node* reverseList(struct Node* head) {
    struct Node* prev = 0;
    struct Node* cur = head;
    while (cur) {
        struct Node* nxt = cur->next;
        cur->next = prev;
        prev = cur;
        cur = nxt;
    }
    return prev;
}
`,
    driver: `#include <stdio.h>
#include <stdlib.h>

static struct Node* mk(int v, struct Node* next) {
    struct Node* n = malloc(sizeof *n);
    n->val = v;
    n->next = next;
    return n;
}

int main(void) {
    struct Node* head = mk(1, mk(2, mk(3, mk(4, 0))));
    struct Node* r = reverseList(head);
    for (struct Node* p = r; p; p = p->next) printf("%d ", p->val);
    printf("\\n");
    while (r) { struct Node* n = r->next; free(r); r = n; }
    return 0;
}
`,
  },
  {
    id: "fib-cpp",
    label: "Recursive Fibonacci (C++)",
    language: "cpp",
    solution: `int fib(int n) {
    if (n < 2) {
        return n;
    }
    return fib(n - 1) + fib(n - 2);
}
`,
    driver: `#include <cstdio>
int main() {
    std::printf("%d\\n", fib(6));
    return 0;
}
`,
  },
  {
    id: "leak-c",
    label: "Memory Demo with a Leak (C)",
    language: "c",
    solution: `#include <stdlib.h>
int* makeSquares(int n) {
    int* a = malloc(sizeof(int) * n);
    for (int i = 0; i < n; i++)
        a[i] = i * i;
    return a;
}
`,
    driver: `#include <stdio.h>
int main(void) {
    int* kept = makeSquares(5);
    int* leaked = makeSquares(4);   /* never freed: shows up as a leak */
    printf("%d %d\\n", kept[4], leaked[3]);
    free(kept);
    return 0;
}
`,
  },
];
