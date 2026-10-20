#!/usr/bin/env sh
# Git credential helper for GitHub HTTPS pushes.
# The token is read from the environment and never written to disk.

if [ "$1" = "get" ]; then
  printf 'username=x-access-token\npassword=%s\n\n' "${GITHUB_TOKEN}"
fi
