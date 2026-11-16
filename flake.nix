{
  description = "mycelia, the one process on a machine that asks the QNTX node";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      forAllSystems = nixpkgs.lib.genAttrs [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      libs = pkgs: [ pkgs.sqlite pkgs.curl pkgs.libsodium ];
    in {
      # The binary alone. On a Mac the Keychain is a signed Mycelia.app's,
      # which `make install` builds with ~/.config/mycelia/signing.mk.
      packages = forAllSystems (system:
        let pkgs = nixpkgs.legacyPackages.${system};
        in rec {
          mycelia = pkgs.stdenv.mkDerivation {
            pname = "mycelia";
            version = self.shortRev or "dirty";
            src = ./.;
            nativeBuildInputs = [ pkgs.ldc ];
            buildInputs = libs pkgs;
            buildPhase = "make mycelia";
            installPhase = "install -D -m 0755 mycelia $out/bin/mycelia";
          };
          default = mycelia;
        });

      devShells = forAllSystems (system:
        let pkgs = nixpkgs.legacyPackages.${system};
        in {
          default = pkgs.mkShell {
            buildInputs = [ pkgs.ldc ] ++ libs pkgs;
          };
        });
    };
}
