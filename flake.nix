{
  description = "A development shell for my portfolio website";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }: let
    system = "x86_64-linux";
    pkgs = nixpkgs.legacyPackages.${system};
  in {
    devShells.${system}.default = pkgs.mkShell {
      name = "Portfolio-dev";
      buildInputs = with pkgs; [
        nodejs
        typescript
        typescript-language-server
        vscode-langservers-extracted
        astro-language-server
        pi-coding-agent
      ];

    shellHook = ''
      echo "Entered the portfolio development shell."
      echo "Node version: $(node --version)"
      echo "npm version: $(npm --version)"
    '';
    };
  };
}
