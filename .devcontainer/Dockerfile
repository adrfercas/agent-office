# The development container: everything `npm run dev`, the tests and the headless screenshots need,
# so nothing has to be installed on the computer itself. Same Node as deploy/container/Dockerfile.
FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8

# git and the GitHub CLI (from GitHub's own apt repo, as in deploy/container/Dockerfile), build tools
# for native modules, `ss` (iproute2) for the office to find the web servers workers start, and sudo
# so post-create can claim the node_modules volume and install the browser's system libraries.
RUN apt-get update \
  && apt-get install -y --no-install-recommends sudo procps iproute2 ca-certificates curl git less build-essential python3 \
  && install -d -m 755 /etc/apt/keyrings \
  && curl -fsSLo /etc/apt/keyrings/githubcli-archive-keyring.gpg https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    >/etc/apt/sources.list.d/github-cli.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends gh \
  && rm -rf /var/lib/apt/lists/* \
  && echo 'node ALL=(ALL) NOPASSWD:ALL' >/etc/sudoers.d/node \
  && chmod 440 /etc/sudoers.d/node

# The office needs at least one agent CLI to hire workers with.
RUN npm install -g @anthropic-ai/claude-code --no-audit --no-fund

USER node
