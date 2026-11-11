#!/bin/sh
# Postern backup.
#
# Use:   sudo sh backup.sh [TARGET-FOLDER]
#
# This script makes a safe copy of the two databases while Postern runs:
#   accounts.db   accounts, mailboxes, messages, numbers (most of it encrypted)
#   payments.db   payment requests and used credit tokens
# It uses the SQLite ".backup" command. That command gives a complete,
# consistent copy. A plain "cp" of a database that is in use can give a
# damaged copy. Do not use "cp" unless Postern is stopped.
#
# Each backup goes into a new folder: TARGET-FOLDER/YYYYMMDD-HHMMSS (UTC time).
# The default TARGET-FOLDER is deploy/backups.
# The script keeps the 7 newest backups and deletes older ones.
# To keep a different number:   sudo KEEP=14 sh backup.sh
# To keep all backups:          sudo KEEP=0 sh backup.sh
#
# THIS SCRIPT DOES NOT COPY THE SERVER SECRET.
# The server secret is SECRET_KEY in the .env file, or the file secret.key in
# the data volume. Without the server secret a backup is not usable: Postern
# cannot find the addresses and numbers in it. Keep one copy of the server
# secret offline (paper, or a USB drive that stays disconnected). Do not keep
# the server secret in the same place as the database backups.
#
# The script also does not copy the .env file. Keep a copy of the .env file
# offline too. It contains your provider keys.
#
# A backup contains everything that was in the database at that time. Data
# that a user deletes later stays in old backups until those backups are deleted.

set -eu

APP_UID=10001
KEEP="${KEEP:-7}"

case "$KEEP" in
  '' | *[!0-9]*) echo "KEEP must be a number." >&2; exit 1 ;;
esac

here=$(cd "$(dirname "$0")" && pwd)
cd "$here"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this script as root:  sudo sh $0" >&2
  exit 1
fi
if [ ! -f .env ]; then
  echo "There is no .env file in $here. Run this script on the Postern server." >&2
  exit 1
fi

target="${1:-$here/backups}"
mkdir -p "$target"
target=$(cd "$target" && pwd)
chmod 700 "$target"

stamp=$(date -u +%Y%m%d-%H%M%S)
out="$target/$stamp"
mkdir "$out"

# If a step fails, remove the incomplete backup folder and say so.
done_ok=0
cleanup() {
  if [ "$done_ok" -ne 1 ]; then
    rm -rf -- "$out"
    echo "BACKUP FAILED. No backup was made." >&2
  fi
}
trap cleanup EXIT

# The backup runs as the Postern user, not as root. Give that user the folder
# for the duration of the backup.
chown "$APP_UID:$APP_UID" "$out"
chmod 700 "$out"

echo "Backup to $out"

# One short-lived container does the work. It has the same data volume as the
# app. It does not stop the app and it does not open network ports.
docker compose run --rm --no-deps -T -v "$out:/backup" app sh -eu -c '
  for name in accounts payments; do
    if [ ! -f "/data/$name.db" ]; then
      echo "ERROR: /data/$name.db does not exist." >&2
      exit 1
    fi
    sqlite3 -cmd ".timeout 20000" "/data/$name.db" ".backup /backup/$name.db"
    check=$(sqlite3 "/backup/$name.db" "PRAGMA integrity_check;")
    if [ "$check" != "ok" ]; then
      echo "ERROR: the copy of $name.db is damaged: $check" >&2
      exit 1
    fi
    echo "  $name.db: copy made and checked"
  done
  if [ -f /data/secret.key ]; then
    echo "  NOTE: the server secret is the file secret.key in the data volume."
    echo "        It is NOT in this backup. To show it, run:"
    echo "        docker compose exec app cat /data/secret.key"
  fi
  other=$(ls -A /data | grep -v -E "^(accounts|payments)\.db(-wal|-shm)?$|^secret\.key$" || true)
  if [ -n "$other" ]; then
    echo "  WARNING: the data volume has more files. They are NOT in this backup:"
    echo "$other" | sed "s/^/    /"
  fi
'

# From here on only root can read the backup.
chown -R root:root "$out"
chmod 600 "$out"/*.db

# Delete old backups. Only folders with a date-time name are deleted.
if [ "$KEEP" -gt 0 ]; then
  cd "$target"
  count=0
  for dir in $(ls -1d [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9] 2>/dev/null | sort -r); do
    count=$((count + 1))
    if [ "$count" -gt "$KEEP" ]; then
      rm -rf -- "./$dir"
      echo "Deleted old backup $dir"
    fi
  done
fi

done_ok=1
echo "Backup complete: $out"
echo "Reminder: the server secret and the .env file are not in this backup."
echo "Copy the backup to a second place. A backup on the same server is lost with the server."
