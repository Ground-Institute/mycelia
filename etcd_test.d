module etcd_test;

// CTFE tests — failure shows as a compile error.

// "our gap is kv"
// What is collected is kept in etcd a key for each agent under /collected/
// (QNTX server/collected_keys_etcd.go). mycelia reads the keys through etcd's
// JSON gateway, where every key and value is base64.
import etcd : base64Into, unbase64Into, keysBodyInto, keyBodyInto, watchBodyInto, revisionOf,
              keysInto, valueInto, said;

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

// "Bound the prefix read so it stays under the gRPC decoding limit" (CodeRabbit,
// QNTX #1768): one range carrying every value passes 4 MiB with a few agents.
// The keys are read alone, from /collected/ to the key after its last, and then
// each value alone, at the revision the keys were read at.
char[128] keys()() {
    char[128] buf = '.';
    keysBodyInto(buf[]);
    return buf;
}

enum KEYS = `{"key":"L2NvbGxlY3RlZC8=","range_end":"L2NvbGxlY3RlZDA=","keys_only":true}`;
static assert(keysBodyInto(new char[128]) == KEYS.length);
static assert(keys!()()[0 .. KEYS.length] == KEYS);

char[128] one(string key, long at)() {
    char[128] buf = '.';
    keyBodyInto(key, at, buf[]);
    return buf;
}

enum ONE = `{"key":"L2NvbGxlY3RlZC9h","revision":"42"}`;
static assert(keyBodyInto("L2NvbGxlY3RlZC9h", 42, new char[128]) == ONE.length);
static assert(one!("L2NvbGxlY3RlZC9h", 42)()[0 .. ONE.length] == ONE);

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

// etcd's answer to a range of keys alone, as l's 3.7.3 gives it: the header's
// revision, and a kv for each key, base64, with no value.
enum KEYED = `{"header":{"cluster_id":"2037210783374497686", "member_id":"13195394291058371180", "revision":"42", "raft_term":"2"}, "kvs":[` ~
    `{"key":"L2NvbGxlY3RlZC9kaWQ6a2V5OmE=", "create_revision":"40", "mod_revision":"41", "version":"2"},` ~
    `{"key":"L2NvbGxlY3RlZC9kaWQ6a2V5OmI=", "create_revision":"42", "mod_revision":"42", "version":"1"}], "count":"2"}`;
enum NONE = `{"header":{"cluster_id":"2037210783374497686", "member_id":"13195394291058371180", "revision":"7", "raft_term":"2"}}`;
// And to one key: its value, base64.
enum VALUED = `{"header":{"cluster_id":"2037210783374497686", "member_id":"13195394291058371180", "revision":"42", "raft_term":"2"}, "kvs":[` ~
    `{"key":"L2NvbGxlY3RlZC9kaWQ6a2V5OmE=", "create_revision":"40", "mod_revision":"41", "version":"2", "value":"eyJ0byI6IkEifQ=="}], "count":"1"}`;

static assert(revisionOf(KEYED) == 42, "the store's revision, not a key's");
static assert(revisionOf(NONE) == 7);
static assert(revisionOf(`{"error":"x"}`) == -1);

// Each key, base64 as etcd gave it, a line each.
char[128] keyed(string answer)() {
    char[128] buf = '.';
    keysInto(answer, buf[]);
    return buf;
}

enum KEPT_KEYS = "L2NvbGxlY3RlZC9kaWQ6a2V5OmE=\nL2NvbGxlY3RlZC9kaWQ6a2V5OmI=\n";
static assert(keysInto(KEYED, new char[128]) == KEPT_KEYS.length);
static assert(keyed!KEYED()[0 .. KEPT_KEYS.length] == KEPT_KEYS);
static assert(keysInto(NONE, new char[128]) == 0, "no key is no line");
static assert(keysInto(KEYED, new char[20]) == size_t.max, "keys that do not fit are not kept cut");

// A key's value, as the text it stands for.
char[64] valued(string answer)() {
    char[64] buf = '.';
    valueInto(answer, buf[]);
    return buf;
}

static assert(valueInto(VALUED, new char[64]) == `{"to":"A"}`.length);
static assert(valued!VALUED()[0 .. 10] == `{"to":"A"}`);
static assert(valueInto(NONE, new char[64]) == size_t.max, "no value is none, not an empty one");
static assert(valueInto(VALUED, new char[4]) == size_t.max, "a value that does not fit is not kept cut");

// A watch says something changed when a message carries events, or when etcd
// ended it; the first message, that it was created, says nothing.
static assert(!said(`{"result":{"header":{"revision":"42"},"created":true}}`));
static assert(said(`{"result":{"header":{"revision":"43"},"events":[{"kv":{"key":"L2NvbGxlY3RlZC9h"}}]}}`));
static assert(said(`{"result":{"header":{"revision":"43"},"canceled":true,"compact_revision":"40"}}`));
