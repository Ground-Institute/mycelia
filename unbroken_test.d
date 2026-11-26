module unbroken_test;

import unbroken : unbroken;

// A client that goes before its answer is written does not end mycelia: the
// write says it is gone. Without `unbroken` this test is ended by the signal.
extern (C) int main() {
    import core.stdc.errno : errno, EPIPE;
    import core.stdc.stdio : printf;
    import core.sys.posix.sys.socket : socketpair, AF_UNIX, SOCK_STREAM;
    import core.sys.posix.unistd : write, close;

    int[2] pair;
    if (socketpair(AF_UNIX, SOCK_STREAM, 0, pair) != 0) {
        printf("FAIL: no pair of sockets\n");
        return 1;
    }
    unbroken();
    close(pair[1]);
    auto answer = "200\n";
    auto wrote = write(pair[0], answer.ptr, answer.length);
    if (wrote != -1 || errno != EPIPE) {
        printf("FAIL: writing to a client that is gone did not say so: %ld, errno %d\n", cast(long) wrote, errno);
        return 1;
    }
    close(pair[0]);
    return 0;
}
