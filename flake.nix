{
  description = "petsupplies-api dev environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in {
        devShells.default = pkgs.mkShell {
          buildInputs = [
            pkgs.nodejs_20
            pkgs.nodePackages.pnpm
            pkgs.stripe-cli
            pkgs.postgresql_15
          ];
          shellHook = ''
            echo "petsupplies-api dev environment"
            echo "Node: $(node --version)"
          '';
        };
      });
}
