module pushed;

// "i see, so it's workable now, but isn't spectacular to demo or be a daily driver, this is very much an early prototype of the core idea."
//
// What is collected was asked of laye every five minutes (COLLECTED_EVERY),
// so what an agent said reached ag up to five minutes late. A thread of its
// own holds laye's watch open instead (laye /laye/collected/watch): laye says
// the person's whole each time it changes, and each is kept in `collected` as
// it arrives. While the watch is held, the passes do not ask.

import core.atomic : atomicLoad, atomicStore;

enum WATCH_PATH = "/laye/collected/watch";

// Held while laye's watch is open and has said something.
private shared bool live_;

bool live() { return atomicLoad(live_); }

// The data of the first whole event in said, and how much of said it took.
// null, and 0 taken, while no event is whole; a whole event that carries no
// data (a comment, laye saying it is still there) is taken with null.
const(char)[] nextEvent(const(char)[] said, out size_t taken) {
    taken = 0;
    foreach (i; 0 .. said.length) {
        if (i + 1 >= said.length || said[i] != '\n' || said[i + 1] != '\n') continue;
        taken = i + 2;
        auto event = said[0 .. i];
        enum data = "data: ";
        if (event.length >= data.length && event[0 .. data.length] == data) return event[data.length .. $];
        return null;
    }
    return null;
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
}

// libcurl 8.18.0's numbers, as http.d reads them off curl.h.
private enum {
    CURLOPT_WRITEDATA       = 10_001,
    CURLOPT_URL             = 10_002,
    CURLOPT_WRITEFUNCTION   = 20_011,
    CURLOPT_LOW_SPEED_LIMIT = 19,
    CURLOPT_LOW_SPEED_TIME  = 20,
    CURLOPT_HTTPHEADER      = 10_023,
    CURLOPT_CONNECTTIMEOUT  = 78,
    CURLOPT_NOSIGNAL        = 99,
    CURLOPT_USERAGENT       = 10_018,
    CURLOPT_PROTOCOLS_STR   = 10_318,
    CURLINFO_RESPONSE_CODE  = 0x200000 + 2,
}

// laye says something at least every 25 seconds; a watch silent for longer
// than this is gone, and is opened again.
enum SILENT_SECONDS = 90;
// How long between tries when the watch could not be held.
enum AGAIN_SECONDS = 5;

import probe : BODY_BYTES;

// The thread's own: nothing here is touched by a pass.
private __gshared char[BODY_BYTES + 4096] said_ = void;
private __gshared size_t saidLen;
private __gshared bool overran;
private __gshared char[512] keptPath = 0;
private __gshared size_t keptPathLen;
private __gshared char[BODY_BYTES] last_ = void;
private __gshared size_t lastLen;

// The moment and the text, written beside `collected` and moved over it.
private void keep(const(char)[] text_) {
    import core.stdc.stdio : fopen, fwrite, fclose, rename;
    import core.stdc.time : time;
    import mycelia : keptInto;
    __gshared char[520] path = void;
    __gshared char[528] beside = void;
    __gshared char[BODY_BYTES + 32] text = void;
    auto n = keptPathLen;
    if (n == 0 || n + 8 > path.length) return;
    foreach (i; 0 .. n) { path[i] = keptPath[i]; beside[i] = keptPath[i]; }
    path[n] = 0;
    foreach (i, c; ".pushed") beside[n + i] = c;
    beside[n + 7] = 0;
    auto t = keptInto(cast(long) time(null), text_, text[]);
    auto f = fopen(&beside[0], "wb");
    if (f is null) return;
    fwrite(text.ptr, 1, t, f);
    fclose(f);
    rename(&beside[0], &path[0]);
}

private extern (C) size_t intoSaid(char* ptr, size_t size, size_t nmemb, void* user) {
    auto n = size * nmemb;
    if (saidLen + n > said_.length) { overran = true; return 0; }
    foreach (i; 0 .. n) said_[saidLen + i] = ptr[i];
    saidLen += n;
    // Each whole event, kept as it arrives; what is not whole yet waits.
    while (true) {
        size_t taken;
        auto data = nextEvent(said_[0 .. saidLen], taken);
        if (taken == 0) break;
        if (data !is null) {
            // The last whole laye said, kept to be stamped again.
            if (data.length <= last_.length) {
                foreach (i, c; data) last_[i] = c;
                lastLen = data.length;
            }
            keep(data);
            atomicStore(live_, true);
        } else if (lastLen > 0) {
            // "mycelia last asked the node 1140s ago: what it kept is not current"
            // laye saying it is still there, with nothing changed, is what was
            // kept being current: kept again with this moment.
            keep(last_[0 .. lastLen]);
        }
        foreach (i; taken .. saidLen) said_[i - taken] = said_[i];
        saidLen -= taken;
    }
    return n;
}

// The person's session, as the binary that holds it gives it: empty while
// none is held.
alias Session = const(char)[] function();

private __gshared Session session_;
private __gshared char[256] host_ = 0;
private __gshared size_t hostLen;

private extern (C) void* watchMain(void*) {
    import core.sys.posix.unistd : sleep;
    import zbuf : ZBuf;
    __gshared ZBuf url, auth;
    while (true) {
        auto held = session_();
        if (held.length == 0) {
            sleep(AGAIN_SECONDS);
            continue;
        }
        url.reset();
        url.put(host_[0 .. hostLen]);
        url.put(WATCH_PATH);
        auth.reset();
        auth.put("Authorization: Bearer ");
        auth.put(held);

        auto h = curl_easy_init();
        if (h is null) { sleep(AGAIN_SECONDS); continue; }
        void* headers = curl_slist_append(null, auth.ptr());
        headers = curl_slist_append(headers, "Accept: text/event-stream\0".ptr);
        saidLen = 0;
        overran = false;
        curl_easy_setopt(h, CURLOPT_URL, url.ptr());
        curl_easy_setopt(h, CURLOPT_PROTOCOLS_STR, "https,http\0".ptr);
        curl_easy_setopt(h, CURLOPT_NOSIGNAL, 1L);
        curl_easy_setopt(h, CURLOPT_CONNECTTIMEOUT, 10L);
        curl_easy_setopt(h, CURLOPT_LOW_SPEED_LIMIT, 1L);
        curl_easy_setopt(h, CURLOPT_LOW_SPEED_TIME, cast(long) SILENT_SECONDS);
        curl_easy_setopt(h, CURLOPT_USERAGENT, "mycelia\0".ptr);
        curl_easy_setopt(h, CURLOPT_HTTPHEADER, headers);
        curl_easy_setopt(h, CURLOPT_WRITEFUNCTION, &intoSaid);
        curl_easy_perform(h);
        long status = 0;
        curl_easy_getinfo(h, CURLINFO_RESPONSE_CODE, &status);
        curl_slist_free_all(headers);
        curl_easy_cleanup(h);
        atomicStore(live_, false);
        // A watch laye ended after its hour is opened again at once; anything
        // else waits, and the passes ask meanwhile.
        if (status != 200 || overran) sleep(AGAIN_SECONDS);
    }
}

// Starts the thread that holds laye's watch at host, keeping what it says at
// path. False when it did not start, and the passes ask laye as before.
bool watchAt(const(char)[] host, const(char)[] path, Session session) {
    import core.sys.posix.pthread : pthread_t, pthread_create;
    if (host.length >= host_.length || path.length >= keptPath.length || session is null) return false;
    foreach (i, c; host) host_[i] = c;
    hostLen = host.length;
    foreach (i, c; path) keptPath[i] = c;
    keptPathLen = path.length;
    session_ = session;
    pthread_t t;
    return pthread_create(&t, null, &watchMain, null) == 0;
}
