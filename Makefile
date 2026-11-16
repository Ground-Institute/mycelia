.PHONY: test install

PREFIX ?= $(HOME)/.local

# Every recipe runs with the compiler and libraries flake.lock pins, the ones CI
# builds with. Outside the pinned shell make enters it and runs the same goals
# there (Ground-Code's Makefile: Homebrew's ldc2 is x86_64 on an arm64 Mac).
PINNED := $(findstring /nix/store/,$(shell command -v ldc2))

ifeq ($(PINNED),)
GOALS := $(or $(MAKECMDGOALS),mycelia)
.PHONY: $(GOALS)
$(firstword $(GOALS)):
	nix develop .#default --command make $(GOALS)
ifneq ($(words $(GOALS)),1)
$(wordlist 2,$(words $(GOALS)),$(GOALS)):
	@:
endif
else

# "so, why would the part that asks the node, not be able to be its own tiny binary"
# No druntime and no GC: ldc2 -betterC, the modules below and what they link.
SOURCES = bin/mycelia.d mycelia.d tmux.d qntx.d statusline.d sql.d named.d probe.d json.d \
          http.d zbuf.d token.d signed.d
LIBS = -L-lsqlite3 -L-lcurl -L-lsodium

# "mycelia connect needs to also be a thing"
# The Keychain (touch.c), and the door the browser comes back to (door.m).
touch.o: touch.c
	clang -c -o $@ touch.c
door.o: door.m
	clang -c -fobjc-arc -o $@ door.m
# A machine with no Keychain and no door, as k: mycelia asks the node and keeps
# what it learns there, and a press made on it says it is the Mac's to make.
touch_none.o: touch_none.c
	$(CC) -c -o $@ touch_none.c
ifeq ($(shell uname -s),Darwin)
OWN = touch.o door.o
OWN_LIBS = -L-framework -LSecurity -L-framework -LCoreFoundation -L-framework -LAppKit -L-framework -LFoundation -L-framework -LLocalAuthentication
else
OWN = touch_none.o
OWN_LIBS =
endif
mycelia: $(SOURCES) $(OWN)
	ldc2 -betterC -of=$@ -I=. $(SOURCES) $(OWN) $(LIBS) $(OWN_LIBS)

# "kept. kept bro, i want to put my finger on, and then not have to thing about it anymore"
# The person's session lives in a Keychain group only a binary signed with the
# team's profile sees, so mycelia is an app: the binary, the profile, and a
# signature naming the group. How this Mac signs is its own, outside the tree.
# The app answers mycelia://, the door the node sends the browser back to, and
# shows nothing: no Dock icon, no menu.
-include $(HOME)/.config/mycelia/signing.mk
Mycelia.app: mycelia
	@test -n "$(MYCELIA_IDENTITY)" || { echo "Mycelia.app: ~/.config/mycelia/signing.mk names no MYCELIA_IDENTITY to sign with"; exit 1; }
	rm -rf $@ && mkdir -p $@/Contents/MacOS
	cp mycelia $@/Contents/MacOS/mycelia
	cp "$(MYCELIA_PROFILE)" $@/Contents/embedded.provisionprofile
	printf '%s\n' '<?xml version="1.0" encoding="UTF-8"?>' '<plist version="1.0"><dict>' \
		'<key>CFBundleIdentifier</key><string>$(MYCELIA_BUNDLE)</string>' \
		'<key>CFBundleExecutable</key><string>mycelia</string>' \
		'<key>CFBundlePackageType</key><string>APPL</string>' \
		'<key>LSUIElement</key><true/>' \
		'<key>CFBundleURLTypes</key><array><dict>' \
		'<key>CFBundleURLName</key><string>$(MYCELIA_BUNDLE).door</string>' \
		'<key>CFBundleURLSchemes</key><array><string>mycelia</string></array>' \
		'</dict></array>' '</dict></plist>' > $@/Contents/Info.plist
	printf '%s\n' '<?xml version="1.0" encoding="UTF-8"?>' '<plist version="1.0"><dict>' \
		'<key>com.apple.application-identifier</key><string>$(MYCELIA_TEAM).$(MYCELIA_BUNDLE)</string>' \
		'<key>com.apple.developer.team-identifier</key><string>$(MYCELIA_TEAM)</string>' \
		'<key>keychain-access-groups</key><array><string>$(MYCELIA_TEAM).$(MYCELIA_BUNDLE)</string></array>' \
		'</dict></plist>' > mycelia.entitlements
	codesign -f -s $(MYCELIA_IDENTITY) --entitlements mycelia.entitlements $@

# CTFE tests compile or fail to; named's and signed's run.
TEST_OUT = build
test:
	mkdir -p $(TEST_OUT)
	ldc2 -c -betterC -od=$(TEST_OUT) -I=. json.d json_test.d
	ldc2 -c -betterC -od=$(TEST_OUT) -I=. sql.d sql_test.d
	ldc2 -c -betterC -od=$(TEST_OUT) -I=. qntx.d json.d qntx_test.d
	ldc2 -c -betterC -od=$(TEST_OUT) -I=. probe.d qntx.d json.d http.d zbuf.d probe_test.d
	ldc2 -c -betterC -od=$(TEST_OUT) -I=. tmux.d statusline.d json.d tmux_test.d
	ldc2 -c -betterC -od=$(TEST_OUT) -I=. mycelia.d tmux.d statusline.d json.d mycelia_test.d
	ldc2 -betterC -of=$(TEST_OUT)/named-test -I=. named.d named_test.d
	$(TEST_OUT)/named-test
	ldc2 -unittest -main -of=$(TEST_OUT)/signed-test -I=. signed.d signed_test.d zbuf.d token.d -L-lsodium
	$(TEST_OUT)/signed-test

# The app lives under PREFIX/lib, and ~/.local/bin/mycelia points into it,
# which is what launchd and systemd run. Renamed into place, never copied over
# the one running (Ground-Code's Makefile, 2026-09-14: a binary cp wrote over
# was SIGKILLed on every launch). The app is registered for mycelia://.
ifeq ($(shell uname -s),Darwin)
install: Mycelia.app
	mkdir -p $(PREFIX)/bin $(PREFIX)/lib/mycelia
	rm -rf $(PREFIX)/lib/mycelia/Mycelia.app.new && cp -R Mycelia.app $(PREFIX)/lib/mycelia/Mycelia.app.new
	rm -rf $(PREFIX)/lib/mycelia/Mycelia.app && mv $(PREFIX)/lib/mycelia/Mycelia.app.new $(PREFIX)/lib/mycelia/Mycelia.app
	ln -sfn ../lib/mycelia/Mycelia.app/Contents/MacOS/mycelia $(PREFIX)/bin/mycelia
	/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f $(PREFIX)/lib/mycelia/Mycelia.app
else
install: mycelia
	mkdir -p $(PREFIX)/bin
	cp mycelia $(PREFIX)/bin/mycelia.new && mv -f $(PREFIX)/bin/mycelia.new $(PREFIX)/bin/mycelia
endif

endif
