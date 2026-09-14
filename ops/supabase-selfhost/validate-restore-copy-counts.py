#!/usr/bin/env python3
import re
import subprocess
import sys
from pathlib import Path


COPY_RE = re.compile(r'^COPY "([^"]+)"\."([^"]+)" .* FROM stdin;$')
SKIPPED_EMPTY_TABLES = {
    ("storage", "buckets_vectors"),
    ("storage", "vector_indexes"),
}


def quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


if len(sys.argv) != 2:
    raise SystemExit(f"Usage: {sys.argv[0]} /protected/path/to/data.sql")

data_path = Path(sys.argv[1])
if not data_path.is_file():
    raise SystemExit(f"Missing data dump: {data_path}")

copy_counts: dict[tuple[str, str], int] = {}
current: tuple[str, str] | None = None
with data_path.open(encoding="utf-8") as data_file:
    for raw_line in data_file:
        line = raw_line.rstrip("\n")
        if current is None:
            match = COPY_RE.match(line)
            if match:
                current = (match.group(1), match.group(2))
                copy_counts[current] = 0
            continue
        if line == r"\.":
            current = None
        else:
            copy_counts[current] += 1

if current is not None:
    raise SystemExit(f"Unterminated COPY block: {current[0]}.{current[1]}")

for table in SKIPPED_EMPTY_TABLES:
    if copy_counts.get(table) != 0:
        raise SystemExit(f"Unsupported Storage vector table is not empty: {table[0]}.{table[1]}")

queries = []
for schema, table in sorted(copy_counts):
    if (schema, table) in SKIPPED_EMPTY_TABLES:
        continue
    label = f"{schema}.{table}".replace("'", "''")
    queries.append(
        f"select '{label}' || E'\\t' || count(*) from "
        f"{quote_identifier(schema)}.{quote_identifier(table)};"
    )

result = subprocess.run(
    [
        "docker",
        "exec",
        "-i",
        "supabase-db",
        "psql",
        "--username",
        "postgres",
        "--dbname",
        "postgres",
        "--no-psqlrc",
        "--tuples-only",
        "--no-align",
        "--set",
        "ON_ERROR_STOP=1",
    ],
    input="\n".join(queries) + "\n",
    text=True,
    capture_output=True,
)
if result.returncode != 0:
    sys.stderr.write(result.stderr)
    raise SystemExit(result.returncode)

destination_counts: dict[tuple[str, str], int] = {}
for line in result.stdout.splitlines():
    label, value = line.split("\t", 1)
    schema, table = label.split(".", 1)
    destination_counts[(schema, table)] = int(value)

mismatches = []
for table, expected in sorted(copy_counts.items()):
    if table in SKIPPED_EMPTY_TABLES:
        continue
    actual = destination_counts.get(table)
    if actual != expected:
        mismatches.append((table, expected, actual))

print(f"copy_tables_checked={len(copy_counts) - len(SKIPPED_EMPTY_TABLES)}")
print(f"copy_rows_expected={sum(copy_counts.values())}")
print(f"copy_rows_destination={sum(destination_counts.values())}")
if mismatches:
    for (schema, table), expected, actual in mismatches:
        print(f"mismatch={schema}.{table} expected={expected} actual={actual}")
    raise SystemExit(1)
print("copy_counts_match=true")
