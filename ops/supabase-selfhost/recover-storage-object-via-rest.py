#!/usr/bin/env python3
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from urllib.parse import quote, urlparse

import requests


if len(sys.argv) != 2 or len(sys.argv[1]) != 16:
    raise SystemExit(f"Usage: {sys.argv[0]} OPAQUE_OBJECT_ID")
opaque_target = sys.argv[1]

for environment_name in (
    "PLATFORM_S3_ENDPOINT",
    "PLATFORM_SERVICE_ROLE_KEY",
    "SELFHOST_SERVICE_ROLE_KEY",
):
    if not os.environ.get(environment_name):
        raise SystemExit(f"Missing environment variable: {environment_name}")

query_result = subprocess.run(
    [
        "docker",
        "exec",
        "supabase-db",
        "psql",
        "--username",
        "postgres",
        "--dbname",
        "postgres",
        "--no-psqlrc",
        "--tuples-only",
        "--no-align",
        "--command",
        "select json_build_object('bucket', bucket_id, 'name', name)::text from storage.objects",
    ],
    text=True,
    capture_output=True,
    check=True,
)

matched = None
for line in query_result.stdout.splitlines():
    item = json.loads(line)
    opaque_id = hashlib.sha256(f"{item['bucket']}/{item['name']}".encode()).hexdigest()[:16]
    if opaque_id == opaque_target:
        matched = item
        break
if matched is None:
    raise SystemExit("Opaque object ID was not found in destination metadata")

source_endpoint = urlparse(os.environ["PLATFORM_S3_ENDPOINT"])
source_host = source_endpoint.netloc.replace(".storage.supabase.co", ".supabase.co")
encoded_path = f"{quote(matched['bucket'], safe='')}/{quote(matched['name'], safe='/')}"
source_url = f"{source_endpoint.scheme}://{source_host}/storage/v1/object/authenticated/{encoded_path}"
source_response = requests.get(
    source_url,
    headers={
        "apikey": os.environ["PLATFORM_SERVICE_ROLE_KEY"],
        "Authorization": f"Bearer {os.environ['PLATFORM_SERVICE_ROLE_KEY']}",
    },
    stream=True,
    timeout=(10, 600),
)
print(f"source_storage_rest_status={source_response.status_code}")
if source_response.status_code != 200:
    try:
        error_payload = source_response.json()
        print(f"source_storage_rest_error={error_payload.get('error', 'unknown')}")
        print(f"source_storage_rest_code={error_payload.get('statusCode', 'unknown')}")
    except requests.exceptions.JSONDecodeError:
        print("source_storage_rest_error=non_json_response")
    raise SystemExit(2)

gateway_ip = subprocess.check_output(
    [
        "docker",
        "inspect",
        "supabase-envoy",
        "--format",
        '{{(index .NetworkSettings.Networks "supabase_default").IPAddress}}',
    ],
    text=True,
).strip()
destination_url = f"http://{gateway_ip}:8000/storage/v1/object/{encoded_path}"
service_key = os.environ["SELFHOST_SERVICE_ROLE_KEY"]

with tempfile.NamedTemporaryFile() as temporary_file:
    source_hasher = hashlib.sha256()
    for chunk in source_response.iter_content(chunk_size=1024 * 1024):
        source_hasher.update(chunk)
        temporary_file.write(chunk)
    temporary_file.flush()
    temporary_file.seek(0)
    upload = requests.post(
        destination_url,
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "x-upsert": "true",
            "Content-Type": source_response.headers.get(
                "Content-Type", "application/octet-stream"
            ),
        },
        data=temporary_file,
        timeout=(10, 600),
    )
    if upload.status_code not in (200, 201):
        raise RuntimeError(f"Destination upload failed: HTTP {upload.status_code}")

destination_response = requests.get(
    destination_url,
    headers={"apikey": service_key, "Authorization": f"Bearer {service_key}"},
    stream=True,
    timeout=(10, 600),
)
if destination_response.status_code != 200:
    raise RuntimeError(
        f"Destination verification failed: HTTP {destination_response.status_code}"
    )
destination_hasher = hashlib.sha256()
for chunk in destination_response.iter_content(chunk_size=1024 * 1024):
    destination_hasher.update(chunk)
if destination_hasher.hexdigest() != source_hasher.hexdigest():
    raise RuntimeError("Destination checksum mismatch")
print("storage_object_recovered=true")
print("storage_object_sha256_verified=true")
