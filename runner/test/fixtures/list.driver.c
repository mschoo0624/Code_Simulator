#include <stdio.h>
#include <stdlib.h>

static struct Node* mk(int v, struct Node* next) {
    struct Node* n = malloc(sizeof *n);
    n->val = v;
    n->next = next;
    return n;
}

int main(void) {
    struct Node* head = mk(1, mk(2, mk(3, 0)));
    struct Node* r = reverseList(head);
    printf("%d %d %d\n", r->val, r->next->val, r->next->next->val);

    /* deliberate cycle: 3 -> 2 -> 1 -> 3, then probe it */
    r->next->next->next = r;
    printf("probe=%d\n", cycleProbe(r));

    /* break the cycle and free */
    struct Node* a = r;
    struct Node* b = r->next;
    struct Node* c = r->next->next;
    free(a); free(b); free(c);
    return 0;
}
