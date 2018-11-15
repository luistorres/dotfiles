#!/bin/zsh

git clone https://github.com/asdf-vm/asdf.git ~/.asdf

source ~/.zshrc

brew install coreutils automake autoconf openssl libyaml readline libxslt libtool unixodbc gpg

asdf plugin-add ruby
asdf plugin-add nodejs

export GNUPGHOME="${ASDF_DIR:-$HOME/.asdf}/keyrings/nodejs" && mkdir -p "$GNUPGHOME" && chmod 0700 "$GNUPGHOME"
bash ~/.asdf/plugins/nodejs/bin/import-release-team-keyring

asdf install ruby "2.5.3"
asdf install nodejs "10.13.0"

asdf global ruby "2.5.3"
asdf global nodejs "10.13.0"

source ~/.zshrc

ruby -v
node -v
