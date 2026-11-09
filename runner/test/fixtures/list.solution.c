struct Node {
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

int cycleProbe(struct Node* head) {
    int n = 0;
    struct Node* p = head;
    while (p && n < 8) {
        p = p->next;
        n++;
    }
    return n;
}
