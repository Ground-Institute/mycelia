module etcd_test;

// CTFE tests — failure shows as a compile error.

// "our gap is kv"
// What is collected is kept in etcd a key for each agent under /collected/
// (QNTX server/collected_keys_etcd.go). mycelia reads the keys through etcd's
// JSON gateway, where every key and value is base64.
import etcd : base64Into, unbase64Into, rangeBodyInto, watchBodyInto, revisionOf,
              collectedInto, said;

char[64] b64(string s)() {
    char[64] buf = '.';
    base64Into(s, buf[]);
    return buf;
}

static assert(b64!"/collected/"()[0 .. 16] == "L2NvbGxlY3RlZC8=");
static assert(b64!"/collected0"()[0 .. 16] == "L2NvbGxlY3RlZDA=");
static assert(base64Into("a", new char[8]) == 4);
static assert(b64!"a"()[0 .. 4] == "YQ==");
static assert(b64!"ab"()[0 .. 4] == "YWI=");
static assert(b64!"abc"()[0 .. 4] == "YWJj");

char[64] un(string s)() {
    char[64] buf = '.';
    unbase64Into(s, buf[]);
    return buf;
}

static assert(unbase64Into("L2NvbGxlY3RlZC8=", new char[64]) == "/collected/".length);
static assert(un!"L2NvbGxlY3RlZC8="()[0 .. 11] == "/collected/");
static assert(un!"YWJj"()[0 .. 3] == "abc");
static assert(unbase64Into("Y!==", new char[8]) == size_t.max, "what is not base64 is not read as some");
static assert(unbase64Into("YWJjZGVm", new char[3]) == size_t.max, "what does not fit is not cut");

// The range is the prefix, from /collected/ to the key after its last.
char[128] range()() {
    char[128] buf = '.';
    rangeBodyInto(buf[]);
    return buf;
}

enum RANGE = `{"key":"L2NvbGxlY3RlZC8=","range_end":"L2NvbGxlY3RlZDA="}`;
static assert(rangeBodyInto(new char[128]) == RANGE.length);
static assert(range!()()[0 .. RANGE.length] == RANGE);

// The watch starts at the revision after the one read: nothing between the
// read and the watch is missed.
char[160] watch(long from)() {
    char[160] buf = '.';
    watchBodyInto(from, buf[]);
    return buf;
}

enum WATCH = `{"create_request":{"key":"L2NvbGxlY3RlZC8=","range_end":"L2NvbGxlY3RlZDA=","start_revision":"43"}}`;
static assert(watchBodyInto(43, new char[160]) == WATCH.length);
static assert(watch!43()[0 .. WATCH.length] == WATCH);

// etcd's answer to a range, as l's 3.7.3 gives it: the header's revision, and
// a kv for each key, its value base64.
enum ANSWER = `{"header":{"cluster_id":"2037210783374497686", "member_id":"13195394291058371180", "revision":"42", "raft_term":"2"}, "kvs":[` ~
    `{"key":"L2NvbGxlY3RlZC9kaWQ6a2V5OmE=", "create_revision":"40", "mod_revision":"41", "version":"2", "value":"eyJ0byI6IkEifQ=="},` ~
    `{"key":"L2NvbGxlY3RlZC9kaWQ6a2V5OmI=", "create_revision":"42", "mod_revision":"42", "version":"1", "value":"eyJ0byI6IkIifQ=="}], "count":"2"}`;
enum NONE = `{"header":{"cluster_id":"2037210783374497686", "member_id":"13195394291058371180", "revision":"7", "raft_term":"2"}}`;

static assert(revisionOf(ANSWER) == 42, "the store's revision, not a key's");
static assert(revisionOf(NONE) == 7);
static assert(revisionOf(`{"error":"x"}`) == -1);

// What is kept is the node's own answer for what is collected: each key's
// value, in the order etcd holds the keys.
char[128] collected(string answer)() {
    char[128] buf = '.';
    collectedInto(answer, buf[]);
    return buf;
}

enum KEPT = `{"collected":[{"to":"A"},{"to":"B"}]}`;
static assert(collectedInto(ANSWER, new char[128]) == KEPT.length);
static assert(collected!ANSWER()[0 .. KEPT.length] == KEPT);
static assert(collected!NONE()[0 .. 16] == `{"collected":[]}`, "no key is nothing collected");
static assert(collectedInto(ANSWER, new char[20]) == 0, "what does not fit is not kept cut");

// A watch says something changed when a message carries events, or when etcd
// ended it; the first message, that it was created, says nothing.
static assert(!said(`{"result":{"header":{"revision":"42"},"created":true}}`));
static assert(said(`{"result":{"header":{"revision":"43"},"events":[{"kv":{"key":"L2NvbGxlY3RlZC9h"}}]}}`));
static assert(said(`{"result":{"header":{"revision":"43"},"canceled":true,"compact_revision":"40"}}`));
