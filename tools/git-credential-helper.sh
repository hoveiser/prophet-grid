#!/usr/bin/env sh
# Git credential helper for GitHub HTTPS pushes.
# The token is read from the environment and never written to disk.
# On any operation other than "get" the helper does nothing, so git never asks
# it to persist the credential anywhere.

if [ "$1" != "get" ]; then
  exit 0
fi

if [ -z "${GITHUB_TOKEN}" ]; then
  # No token in the environment: stay silent so the push fails instead of
  # falling back to an interactive prompt.
  exit 1
fi

printf 'username=x-access-token\npassword=%s\n\n' "${GITHUB_TOKEN}"
