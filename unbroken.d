module unbroken;

// "i see it here. and its gone, and its here"
//
// mycelia answers whoever asks its socket, and one that goes before its answer
// is written is told nothing. Writing to it raised SIGPIPE, which ended
// mycelia (launchd: last exit -13, 2026-11-26): until it was started again
// every ag was refused, and drew that in place of what waits. Here the signal
// is ignored for the whole of mycelia, so that write says the client is gone
// and mycelia answers the next.
extern (C) void unbroken() @nogc nothrow {
    import core.stdc.signal : signal, SIG_IGN;
    import core.sys.posix.signal : SIGPIPE;
    signal(SIGPIPE, SIG_IGN);
}
