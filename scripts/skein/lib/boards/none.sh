#!/usr/bin/env bash
# Board: none. A single coordinator with no shared claims. The repo cap then counts only
# what this machine runs. Same interface as boards/github.sh; everything is a no-op.
board_claim() { return 0; }
board_release() { return 0; }
board_close() { return 0; }
board_owner() { printf ''; }
board_running_count() { driver_running_count 2>/dev/null || echo 0; }
board_list() { return 0; }
board_comment() { return 0; }
