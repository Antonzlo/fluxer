#!/usr/bin/env python3
"""Set each tracked file's mtime to the time of the last commit that changed it.

A fresh checkout stamps every file with the checkout time, so Cargo thinks all sources are newer than
its cached build records and recompiles everything. With commit-time mtimes only files that really
changed since the cached build look new.
"""
import os
import subprocess
import sys

root = sys.argv[1]
log = subprocess.run(
    ["git", "-c", "core.quotepath=off", "log", "--format=@%ct", "--name-only", "--no-renames"],
    cwd=root,
    check=True,
    capture_output=True,
    text=True,
    encoding="utf-8",
).stdout

seen = set()
stamp = 0
restored = 0
for line in log.splitlines():
    if not line:
        continue
    if line[0] == "@":
        stamp = int(line[1:])
        continue
    if line in seen:
        continue
    seen.add(line)
    path = os.path.join(root, line)
    if os.path.isfile(path) and not os.path.islink(path):
        os.utime(path, (stamp, stamp))
        restored += 1
print(f"restored mtimes for {restored} files in {root}")
