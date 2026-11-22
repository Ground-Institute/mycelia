module pushed_test;

// CTFE tests — failure shows as a compile error.

// laye says what is collected as server-sent events: `data: <whole>` and an
// empty line, and `: quiet` while nothing changes.
import pushed : nextEvent;

size_t takenOf(string s)() {
    size_t taken;
    nextEvent(s, taken);
    return taken;
}

string dataOf(string s)() {
    size_t taken;
    auto d = nextEvent(s, taken);
    return d is null ? "<none>" : d.idup;
}

// A whole event: its data, and all of it taken.
static assert(dataOf!"data: {\"collected\":[]}\n\n"() == `{"collected":[]}`);
static assert(takenOf!"data: {\"collected\":[]}\n\n"() == 24);

// Not whole yet: nothing taken, it waits for the rest.
static assert(takenOf!"data: {\"collected\":["() == 0);
static assert(takenOf!"data: {}\n"() == 0);

// laye saying it is still there is taken, and keeps nothing.
static assert(dataOf!": quiet\n\n"() == "<none>");
static assert(takenOf!": quiet\n\n"() == 9);

// Two at once: the first, then what follows waits to be read.
static assert(dataOf!"data: 1\n\ndata: 2\n\n"() == "1");
static assert(takenOf!"data: 1\n\ndata: 2\n\n"() == 9);
