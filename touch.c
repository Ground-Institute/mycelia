// The person's session at the node, kept in the Keychain behind Touch ID.
//
// "kept. kept bro, i want to put my finger on, and then not have to thing about it anymore"
//
// Only a binary signed with the team's profile and its Keychain group sees the
// item (an unsigned one is refused -34018, and finds nothing), and taking the
// session out asks for a touch. What mycelia takes out it holds until it stops.

#include <Security/Security.h>
#include <string.h>

static CFMutableDictionaryRef item(CFStringRef account) {
    CFMutableDictionaryRef q = CFDictionaryCreateMutable(NULL, 0, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    CFDictionarySetValue(q, kSecClass, kSecClassGenericPassword);
    CFDictionarySetValue(q, kSecAttrService, CFSTR("mycelia"));
    CFDictionarySetValue(q, kSecAttrAccount, account);
    CFDictionarySetValue(q, kSecUseDataProtectionKeychain, kCFBooleanTrue);
    return q;
}

static CFMutableDictionaryRef session(void) { return item(CFSTR("session")); }

// "mycelia jusk asked for my finger twice in a row"
// The secrets ag was paired with, kept as the session is: in this group alone,
// readable once the Mac is unlocked. A mycelia that starts again holds them
// again, and asks no finger for them. The OSStatus.
int touch_keep_paired(const unsigned char *held, int n) {
    CFMutableDictionaryRef gone = item(CFSTR("paired"));
    OSStatus st = SecItemDelete(gone);
    CFRelease(gone);
    if (st != errSecSuccess && st != errSecItemNotFound) return st;
    if (n == 0) return errSecSuccess;
    CFMutableDictionaryRef q = item(CFSTR("paired"));
    CFDictionarySetValue(q, kSecAttrAccessible, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly);
    CFDataRef v = CFDataCreate(NULL, held, n);
    CFDictionarySetValue(q, kSecValueData, v);
    st = SecItemAdd(q, NULL);
    CFRelease(v);
    CFRelease(q);
    return st;
}

// The secrets kept, into out. The OSStatus; the bytes in *n.
int touch_take_paired(unsigned char *out, int cap, int *n) {
    *n = 0;
    CFMutableDictionaryRef q = item(CFSTR("paired"));
    CFDictionarySetValue(q, kSecReturnData, kCFBooleanTrue);
    CFTypeRef got = NULL;
    OSStatus st = SecItemCopyMatching(q, &got);
    if (st == errSecSuccess) {
        CFIndex len = CFDataGetLength((CFDataRef) got);
        if (len > cap) st = errSecBufferTooSmall;
        else { memcpy(out, CFDataGetBytePtr((CFDataRef) got), len); *n = (int) len; }
        CFRelease(got);
    }
    CFRelease(q);
    return st;
}

// Keeps the session on this device, in place of the one kept before: a new
// passkey at home is a new session. The OSStatus.
//
// "next reboot i expect to have to put my finger again."
// Readable once the Mac is unlocked after it starts, and not before: the
// finger at the login is the touch, once a boot. A touch asked of every
// mycelia that starts was asked again at every install and restart.
int touch_keep(const unsigned char *held, int n) {
    CFMutableDictionaryRef gone = session();
    OSStatus st = SecItemDelete(gone);
    CFRelease(gone);
    if (st != errSecSuccess && st != errSecItemNotFound) return st;

    CFMutableDictionaryRef q = session();
    CFDictionarySetValue(q, kSecAttrAccessible, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly);
    CFDataRef v = CFDataCreate(NULL, held, n);
    CFDictionarySetValue(q, kSecValueData, v);
    st = SecItemAdd(q, NULL);
    CFRelease(v);
    CFRelease(q);
    return st;
}

// Takes the session out into out, asking for a touch with prompt. The
// OSStatus; the bytes taken in *n.
int touch_take(unsigned char *out, int cap, const char *prompt, int *n) {
    *n = 0;
    CFMutableDictionaryRef q = session();
    CFDictionarySetValue(q, kSecReturnData, kCFBooleanTrue);
    CFStringRef p = CFStringCreateWithCString(NULL, prompt, kCFStringEncodingUTF8);
    CFDictionarySetValue(q, kSecUseOperationPrompt, p);
    CFTypeRef got = NULL;
    OSStatus st = SecItemCopyMatching(q, &got);
    if (st == errSecSuccess) {
        CFIndex len = CFDataGetLength((CFDataRef) got);
        if (len > cap) st = errSecBufferTooSmall;
        else { memcpy(out, CFDataGetBytePtr((CFDataRef) got), len); *n = (int) len; }
        CFRelease(got);
    }
    CFRelease(p);
    CFRelease(q);
    return st;
}

// Removes the person's seed kept before presses were made in the session
// (account "person"), which nothing reads since. Only this signed binary
// reaches the item. The OSStatus; errSecItemNotFound is nothing left to remove.
int touch_forget_seed(void) {
    CFMutableDictionaryRef q = CFDictionaryCreateMutable(NULL, 0, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    CFDictionarySetValue(q, kSecClass, kSecClassGenericPassword);
    CFDictionarySetValue(q, kSecAttrService, CFSTR("mycelia"));
    CFDictionarySetValue(q, kSecAttrAccount, CFSTR("person"));
    CFDictionarySetValue(q, kSecUseDataProtectionKeychain, kCFBooleanTrue);
    OSStatus st = SecItemDelete(q);
    CFRelease(q);
    return st;
}

// What an OSStatus says, in Apple's words, into out.
void touch_said(int st, char *out, int cap) {
    out[0] = 0;
    CFStringRef m = SecCopyErrorMessageString(st, NULL);
    if (m) { CFStringGetCString(m, out, cap, kCFStringEncodingUTF8); CFRelease(m); }
}
