module etcd;

// "our gap is kv"
//
// Where the node keeps what is collected in etcd, a key for each agent under
// /collected/ (QNTX server/collected_keys_etcd.go, the value what collected
// list says of the agent), mycelia does not ask the node for it. A thread of
// its own reads the keys, watches them from the revision it read, and keeps
// them in `collected` each time one changes. It is the only writer of
// `collected` then, and touches none of the buffers the passes use.

import core.stdc.stdio : fopen, fwrite, fclose, rename;

enum PREFIX = "/collected/";
// The key after every key under the prefix: '/' + 1 is '0'.
enum PREFIX_END = "/collected0";

// QNTX_ETCD_ENDPOINT names the etcd, as it does for QNTX's own tests
// (scripts/with-etcd.sh). Null when it names none.
const(char)[] endpoint() {
    import core.stdc.stdlib : getenv;
    auto e = getenv("QNTX_ETCD_ENDPOINT\0".ptr);
    if (e is null) return null;
    size_t n = 0;
    while (e[n] != 0) n++;
    return n > 0 ? e[0 .. n] : null;
}

private enum ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// src as base64, with padding. 0 when it does not fit.
size_t base64Into(const(char)[] src, char[] dest) {
    auto need = (src.length + 2) / 3 * 4;
    if (need > dest.length) return 0;
    size_t o = 0;
    for (size_t i = 0; i < src.length; i += 3) {
        uint v = cast(ubyte) src[i] << 16;
        if (i + 1 < src.length) v |= cast(ubyte) src[i + 1] << 8;
        if (i + 2 < src.length) v |= cast(ubyte) src[i + 2];
        dest[o++] = ALPHABET[(v >> 18) & 63];
        dest[o++] = ALPHABET[(v >> 12) & 63];
        dest[o++] = i + 1 < src.length ? ALPHABET[(v >> 6) & 63] : '=';
        dest[o++] = i + 2 < src.length ? ALPHABET[v & 63] : '=';
    }
    return o;
}

private int sextet(char c) {
    if (c >= 'A' && c <= 'Z') return c - 'A';
    if (c >= 'a' && c <= 'z') return c - 'a' + 26;
    if (c >= '0' && c <= '9') return c - '0' + 52;
    if (c == '+') return 62;
    if (c == '/') return 63;
    return -1;
}

// base64 as the bytes it stands for. size_t.max when it is not base64, or
// does not fit: a value cut short is not the value.
size_t unbase64Into(const(char)[] src, char[] dest) {
    if (src.length % 4 != 0) return size_t.max;
    size_t o = 0;
    for (size_t i = 0; i < src.length; i += 4) {
        int[4] s;
        size_t pad = 0;
        foreach (j; 0 .. 4) {
            auto c = src[i + j];
            if (c == '=' && i + 4 == src.length && j >= 2) { s[j] = 0; pad++; continue; }
            if (pad > 0) return size_t.max;
            s[j] = sextet(c);
            if (s[j] < 0) return size_t.max;
        }
        uint v = (s[0] << 18) | (s[1] << 12) | (s[2] << 6) | s[3];
        auto bytes = 3 - pad;
        if (o + bytes > dest.length) return size_t.max;
        dest[o++] = cast(char)((v >> 16) & 0xff);
        if (bytes > 1) dest[o++] = cast(char)((v >> 8) & 0xff);
        if (bytes > 2) dest[o++] = cast(char)(v & 0xff);
    }
    return o;
}

private struct Out {
    char[] dest;
    size_t o;
    bool full;
    void put(const(char)[] t) {
        foreach (c; t) { if (o < dest.length) dest[o++] = c; else full = true; }
    }
    void putB64(const(char)[] t) {
        auto n = base64Into(t, dest[o .. $]);
        if (n == 0 && t.length > 0) full = true;
        o += n;
    }
}

// What /v3/kv/range is asked: every key under the prefix.
size_t rangeBodyInto(char[] dest) {
    auto w = Out(dest);
    w.put(`{"key":"`);
    w.putB64(PREFIX);
    w.put(`","range_end":"`);
    w.putB64(PREFIX_END);
    w.put(`"}`);
    return w.full ? 0 : w.o;
}

// What /v3/watch is asked: every key under the prefix, from revision from.
size_t watchBodyInto(long from, char[] dest) {
    auto w = Out(dest);
    w.put(`{"create_request":{"key":"`);
    w.putB64(PREFIX);
    w.put(`","range_end":"`);
    w.putB64(PREFIX_END);
    w.put(`","start_revision":"`);
    char[24] d = 0;
    size_t dl = 0;
    long v = from;
    if (v <= 0) d[dl++] = '0';
    else while (v > 0 && dl < d.length) { d[dl++] = cast(char)('0' + v % 10); v /= 10; }
    foreach_reverse (i; 0 .. dl) w.put(d[i .. i + 1]);
    w.put(`"}}`);
    return w.full ? 0 : w.o;
}

// The store's revision an answer was read at: the header's, which comes
// first. -1 when there is none.
long revisionOf(const(char)[] answer) {
    import json : jsonString;
    auto r = jsonString(answer, "revision");
    if (r is null || r.length == 0) return -1;
    long v = 0;
    foreach (c; r) {
        if (c < '0' || c > '9') return -1;
        v = v * 10 + (c - '0');
    }
    return v;
}

// Where the next `"value"` string begins after at, and where it ends; the
// answer's length when there is none.
private size_t nextValue(const(char)[] answer, size_t at, out size_t end) {
    enum key = `"value"`;
    for (size_t i = at; i + key.length < answer.length; i++) {
        if (answer[i .. i + key.length] != key) continue;
        size_t j = i + key.length;
        while (j < answer.length && answer[j] == ' ') j++;
        if (j >= answer.length || answer[j] != ':') continue;
        j++;
        while (j < answer.length && answer[j] == ' ') j++;
        if (j >= answer.length || answer[j] != '"') continue;
        end = j + 1;
        while (end < answer.length && answer[end] != '"') end++;
        return j + 1;
    }
    end = answer.length;
    return answer.length;
}

// The node's answer for what is collected, made of each key's value in the
// order etcd holds them. 0 when it does not fit or a value is not base64:
// what is cut is not kept.
size_t collectedInto(const(char)[] answer, char[] dest) {
    auto w = Out(dest);
    w.put(`{"collected":[`);
    size_t at = 0;
    bool first = true;
    while (true) {
        size_t end;
        auto start = nextValue(answer, at, end);
        if (start >= answer.length) break;
        if (!first) w.put(",");
        first = false;
        if (w.full) return 0;
        auto n = unbase64Into(answer[start .. end], dest[w.o .. $]);
        if (n == size_t.max) return 0;
        w.o += n;
        at = end + 1;
    }
    w.put("]}");
    return w.full ? 0 : w.o;
}

// A watch's message says something changed: it carries events, or etcd ended
// the watch. The first, that it was created, says nothing.
bool said(const(char)[] message) {
    foreach (needle; [`"events"`, `"canceled"`]) {
        if (needle.length > message.length) continue;
        foreach (i; 0 .. message.length - needle.length + 1)
            if (message[i .. i + needle.length] == needle) return true;
    }
    return false;
}

// --- The thread ---

extern (C) {
    void* curl_easy_init();
    int curl_easy_setopt(void* handle, int option, ...);
    int curl_easy_getinfo(void* handle, int info, ...);
    int curl_easy_perform(void* handle);
    void curl_easy_cleanup(void* handle);
    void* curl_slist_append(void* list, const(char)* line);
    void curl_slist_free_all(void* list);
    const(char)* curl_easy_strerror(int code);
}

// libcurl 8.18.0's numbers, as http.d reads them off curl.h.
private enum {
    CURLOPT_WRITEDATA      = 10_001,
    CURLOPT_URL            = 10_002,
    CURLOPT_WRITEFUNCTION  = 20_011,
    CURLOPT_TIMEOUT        = 13,
    CURLOPT_POSTFIELDS     = 10_015,
    CURLOPT_HTTPHEADER     = 10_023,
    CURLOPT_POSTFIELDSIZE  = 60,
    CURLOPT_NOSIGNAL       = 99,
    CURLOPT_PROTOCOLS_STR  = 10_318,
    CURLINFO_RESPONSE_CODE = 0x200000 + 2,
}

// The most a range answer may be: every agent's value, base64.
enum ANSWER_BYTES = 8 << 20;
// How long one watch waits before the keys are read again whole.
enum WATCH_SECONDS = 300;

// The thread's own: nothing here is touched by a pass.
private __gshared char[ANSWER_BYTES] answerBuf = void;
private __gshared size_t answerLen;
private __gshared bool answerOverran;
private __gshared bool watchSaid;
// The last bytes of the previous piece, so a word split across pieces is seen.
private __gshared char[16] carry = 0;
private __gshared size_t carryLen;

private extern (C) size_t intoAnswer(char* ptr, size_t size, size_t nmemb, void* user) {
    auto n = size * nmemb;
    if (answerLen + n > answerBuf.length) { answerOverran = true; return 0; }
    foreach (i; 0 .. n) answerBuf[answerLen + i] = ptr[i];
    answerLen += n;
    return n;
}

private extern (C) size_t intoWatch(char* ptr, size_t size, size_t nmemb, void* user) {
    auto n = size * nmemb;
    __gshared char[16 + 65536] seen = void;
    // What came, a window at a time, with what the last piece ended on.
    size_t at = 0;
    while (at < n) {
        auto take = n - at < 65536 ? n - at : 65536;
        foreach (i; 0 .. carryLen) seen[i] = carry[i];
        foreach (i; 0 .. take) seen[carryLen + i] = ptr[at + i];
        auto all = seen[0 .. carryLen + take];
        if (said(all)) { watchSaid = true; return 0; }
        carryLen = all.length < carry.length ? all.length : carry.length;
        foreach (i; 0 .. carryLen) carry[i] = all[all.length - carryLen + i];
        at += take;
    }
    return n;
}

private struct Asked {
    int status;
    int code;
    char[256] why = 0;
    size_t whyLen;
}

// One POST of body to endpoint ~ path, the answer into the thread's buffer or
// watched for a change.
private Asked ask(const(char)[] host, const(char)[] path, const(char)[] body_, bool watching, int seconds) {
    Asked r;
    void say(const(char)[] s) { foreach (c; s) if (r.whyLen < r.why.length) r.why[r.whyLen++] = c; }
    __gshared char[512] url = void;
    if (host.length + path.length + 1 > url.length) { r.code = -1; say("the etcd endpoint is longer than mycelia holds"); return r; }
    size_t u = 0;
    foreach (c; host) url[u++] = c;
    foreach (c; path) url[u++] = c;
    url[u] = 0;

    auto h = curl_easy_init();
    if (h is null) { r.code = -1; say("libcurl could not start a handle"); return r; }
    scope (exit) curl_easy_cleanup(h);
    void* headers = curl_slist_append(null, "Content-Type: application/json\0".ptr);
    scope (exit) curl_slist_free_all(headers);

    answerLen = 0;
    answerOverran = false;
    watchSaid = false;
    carryLen = 0;
    curl_easy_setopt(h, CURLOPT_URL, &url[0]);
    curl_easy_setopt(h, CURLOPT_PROTOCOLS_STR, "http,https\0".ptr);
    curl_easy_setopt(h, CURLOPT_NOSIGNAL, 1L);
    curl_easy_setopt(h, CURLOPT_TIMEOUT, cast(long) seconds);
    curl_easy_setopt(h, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(h, CURLOPT_WRITEFUNCTION, watching ? &intoWatch : &intoAnswer);
    curl_easy_setopt(h, CURLOPT_POSTFIELDSIZE, cast(long) body_.length);
    curl_easy_setopt(h, CURLOPT_POSTFIELDS, body_.ptr);
    r.code = curl_easy_perform(h);
    long status = 0;
    curl_easy_getinfo(h, CURLINFO_RESPONSE_CODE, &status);
    r.status = cast(int) status;
    if (r.code != 0 && !watchSaid) {
        auto s = curl_easy_strerror(r.code);
        size_t m = 0;
        while (s !is null && s[m] != 0) m++;
        say(s[0 .. m]);
    }
    return r;
}

// The moment and the text at path, written beside it and moved over, from the
// thread's own buffers.
private void keepAt(const(char)[] at, long now, const(char)[] text_) {
    __gshared char[512] path = void;
    __gshared char[520] beside = void;
    __gshared char[ANSWER_BYTES + 32] text = void;
    auto n = at.length;
    if (n == 0 || n + 6 > path.length) return;
    foreach (i, c; at) { path[i] = c; beside[i] = c; }
    path[n] = 0;
    foreach (i, c; ".etcd") beside[n + i] = c;
    beside[n + 5] = 0;
    import mycelia : keptInto;
    auto t = keptInto(now, text_, text[]);
    auto f = fopen(&beside[0], "wb");
    if (f is null) return;
    fwrite(text.ptr, 1, t, f);
    fclose(f);
    rename(&beside[0], &path[0]);
}

private __gshared char[512] keptPath = 0;
private __gshared size_t keptPathLen;
private __gshared char[256] host_ = 0;
private __gshared size_t hostLen;

// What went wrong reading etcd, kept where what is collected would be.
private void refused(long now, const(char)[] what, ref Asked r) {
    __gshared char[400] why = void;
    auto w = Out(why[]);
    w.put("etcd at ");
    w.put(host_[0 .. hostLen]);
    w.put(" ");
    w.put(what);
    w.put(": ");
    if (r.whyLen > 0) w.put(r.why[0 .. r.whyLen]);
    else if (answerOverran) w.put("answered with more than mycelia holds");
    else {
        w.put("answered ");
        char[12] d = 0;
        size_t dl = 0;
        int v = r.status;
        if (v <= 0) d[dl++] = '0';
        while (v > 0 && dl < d.length) { d[dl++] = cast(char)('0' + v % 10); v /= 10; }
        foreach_reverse (i; 0 .. dl) w.put(d[i .. i + 1]);
    }
    keepAt(keptPath[0 .. keptPathLen], now, why[0 .. w.o]);
}

private extern (C) void* watchMain(void*) {
    import core.stdc.time : time;
    import core.sys.posix.unistd : sleep;
    __gshared char[160] request = void;
    __gshared char[ANSWER_BYTES] kept = void;
    while (true) {
        auto rb = rangeBodyInto(request[]);
        auto r = ask(host_[0 .. hostLen], "/v3/kv/range", request[0 .. rb], false, 10);
        auto now = cast(long) time(null);
        if (r.code != 0 || r.status != 200 || answerOverran) {
            refused(now, "did not give what is collected", r);
            sleep(5);
            continue;
        }
        auto answer = answerBuf[0 .. answerLen];
        auto from = revisionOf(answer);
        auto k = collectedInto(answer, kept[]);
        if (k == 0 || from < 0) {
            Asked none;
            foreach (c; "gave what mycelia does not read as what is collected")
                if (none.whyLen < none.why.length) none.why[none.whyLen++] = c;
            refused(now, "read", none);
            sleep(5);
            continue;
        }
        keepAt(keptPath[0 .. keptPathLen], now, kept[0 .. k]);

        // Watched from the revision after the one read, until something
        // changes, the watch ends, or it waited WATCH_SECONDS.
        auto wb = watchBodyInto(from + 1, request[]);
        auto w = ask(host_[0 .. hostLen], "/v3/watch", request[0 .. wb], true, WATCH_SECONDS);
        if (!watchSaid && w.code != 0 && w.code != 28) {
            // 28 is CURLE_OPERATION_TIMEDOUT: the watch waited its time.
            refused(cast(long) time(null), "ended the watch", w);
            sleep(5);
        }
    }
}

// Starts the thread that keeps what is collected from etcd at host, kept at
// path. False when it did not start, and the passes ask the node as before.
bool watchFrom(const(char)[] host, const(char)[] path) {
    import core.sys.posix.pthread : pthread_t, pthread_create;
    if (host.length >= host_.length || path.length >= keptPath.length) return false;
    foreach (i, c; host) host_[i] = c;
    hostLen = host.length;
    foreach (i, c; path) keptPath[i] = c;
    keptPathLen = path.length;
    pthread_t t;
    return pthread_create(&t, null, &watchMain, null) == 0;
}
