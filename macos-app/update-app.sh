#!/bin/zsh
# Shared transactional bundle installer. Sourcing defines functions only.

function gp_error() { print -u2 -- "GitPulse: $*"; return 1; }

function gp_update_target_allowed() {
  [[ "$1" == '/Applications/GitPulse.app' ||
     "$1" == "$HOME/Applications/GitPulse.app" ||
     "$1" == "$HOME/Applications/Bitbucket PR Approver.app" ]]
}

function gp_verify_signature() { /usr/bin/codesign --verify --deep --strict "$1"; }
function gp_copy_bundle() { /usr/bin/ditto "$1" "$2"; }
function gp_move_bundle() { /bin/mv "$1" "$2"; }

function gp_validate_bundle() {
  local candidate="$1" expected="$2" identifier version
  [[ -d "$candidate" && ! -L "$candidate" ]] || { gp_error 'Invalid bundle or symlink source.'; return 1; }
  [[ "$expected" == <->.<->.<-> ]] || { gp_error 'Invalid expected version.'; return 1; }
  identifier="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$candidate/Contents/Info.plist" 2>/dev/null)" || return 1
  [[ "$identifier" == 'com.hungnv.bitbucket-pr-approver.mac' ]] || { gp_error 'Bundle identity mismatch.'; return 1; }
  version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$candidate/Contents/Info.plist" 2>/dev/null)" || return 1
  [[ "$version" == "$expected" ]] || { gp_error 'Bundle version mismatch.'; return 1; }
  gp_verify_signature "$candidate" || { gp_error 'Bundle signature verification failed.'; return 1; }
}

function gp_preflight_target() {
  local target="$1" parent="${1:h}" probe
  [[ ! -L "$target" && ! -L "$parent" ]] || { gp_error 'Refusing symlink target or parent.'; return 1; }
  [[ ! -e "$target" || -d "$target" ]] || { gp_error 'Target is not an application directory.'; return 1; }
  [[ -d "$parent" && -w "$parent" && -x "$parent" && (! -e "$target" || -w "$target") ]] || {
    gp_error "Target is not writable: $target. No administrator elevation will be attempted."; return 1
  }
  # Check actual create permission (including ACLs) before the running app exits.
  probe="$(/usr/bin/mktemp -d "$parent/.gitpulse-preflight.XXXXXX")" || {
    gp_error "Cannot write to $parent. No administrator elevation will be attempted."; return 1
  }
  /bin/rmdir "$probe" || return 1
}

# 0 = running, 1 = not running, 2 = could not inspect (fail closed).
function gp_target_running() {
  local processes line
  processes="$(/bin/ps -axo comm=)" || return 2
  for line in "${(@f)processes}"; do
    line="${line##[[:space:]]#}"
    [[ "$line" == "$1/Contents/MacOS/"* ]] && return 0
  done
  return 1
}

function gp_require_stopped() {
  local result
  if gp_target_running "$1"; then
    gp_error "Target app is running. Quit it before installing: $1"; return 1
  else
    result=$?
    [[ "$result" == 1 ]] || { gp_error 'Cannot inspect running applications; refusing installation.'; return 1; }
  fi
}

function gp_install_bundle() (
  local candidate="$1" target="$2" expected="$3" work='' backed_up=0 promoted=0
  gp_validate_bundle "$candidate" "$expected" || return 1
  gp_preflight_target "$target" || return 1
  gp_require_stopped "$target" || return 1
  work="$(/usr/bin/mktemp -d "${target:h}/.gitpulse-install.XXXXXX")" || return 1
  # work is a private mktemp directory on the destination filesystem, never user data.
  function gp_cleanup_transaction() {
    if (( backed_up && ! promoted )); then
      if ! gp_move_bundle "$work/previous.app" "$target"; then
        gp_error "Rollback failed. Original app preserved at $work/previous.app"
        return 1
      fi
    fi
    [[ "$work" == "${target:h}/.gitpulse-install."* && -d "$work" && ! -L "$work" ]] && /bin/rm -rf -- "$work"
  }
  trap 'gp_cleanup_transaction' EXIT
  trap 'exit 1' HUP INT TERM
  gp_copy_bundle "$candidate" "$work/candidate.app" || { gp_error 'Failed to stage bundle; original app unchanged.'; return 1; }
  gp_validate_bundle "$work/candidate.app" "$expected" || return 1
  gp_preflight_target "$target" || return 1
  gp_require_stopped "$target" || return 1
  if [[ -e "$target" ]]; then
    gp_move_bundle "$target" "$work/previous.app" || return 1
    backed_up=1
  fi
  gp_move_bundle "$work/candidate.app" "$target" || { gp_error 'Installation failed; restoring previous app.'; return 1; }
  promoted=1
)

function gp_update_main() {
  if [[ "${1:-}" == '--preflight' ]]; then
    [[ "$#" == 2 ]] && gp_update_target_allowed "$2" || { gp_error 'Unsupported update target.'; return 1; }
    gp_preflight_target "$2"
    return $?
  fi
  local candidate="${1:-}" target="${2:-}" old_pid="${3:-}" expected="${4:-}"
  [[ "$#" == 4 && "$old_pid" == <-> ]] && gp_update_target_allowed "$target" || { gp_error 'Unsupported update arguments or target.'; return 1; }
  gp_validate_bundle "$candidate" "$expected" || return 1
  gp_preflight_target "$target" || return 1
  for _ in {1..60}; do
    if ! /bin/kill -0 "$old_pid" 2>/dev/null; then break; fi
    /bin/sleep 1
  done
  if /bin/kill -0 "$old_pid" 2>/dev/null; then gp_error 'Existing application has not exited.'; return 1; fi
  gp_install_bundle "$candidate" "$target" "$expected" || return 1
  /usr/bin/open -n "$target"
}

if [[ "${ZSH_EVAL_CONTEXT:-}" != *:file ]]; then
  set -euo pipefail
  gp_update_main "$@"
fi
