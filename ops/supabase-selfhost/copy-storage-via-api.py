#!/usr/bin/env python3
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from urllib.parse import quote

import boto3
import requests
from botocore.config import Config
from botocore.exceptions import ClientError


required_environment = (
    "PLATFORM_S3_ACCESS_KEY_ID",
    "PLATFORM_S3_SECRET_ACCESS_KEY",
    "PLATFORM_S3_ENDPOINT",
    "SELFHOST_SERVICE_ROLE_KEY",
)
for environment_name in required_environment:
    if not os.environ.get(environment_name):
        raise SystemExit(f"Missing environment variable: {environment_name}")

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
destination_base = f"http://{gateway_ip}:8000/storage/v1/object"
service_key = os.environ["SELFHOST_SERVICE_ROLE_KEY"]

source = boto3.client(
    "s3",
    endpoint_url=os.environ["PLATFORM_S3_ENDPOINT"],
    region_name=os.environ.get("PLATFORM_S3_REGION", "sa-east-1"),
    aws_access_key_id=os.environ["PLATFORM_S3_ACCESS_KEY_ID"],
    aws_secret_access_key=os.environ["PLATFORM_S3_SECRET_ACCESS_KEY"],
    config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
)

query = "select json_build_object('bucket', bucket_id, 'name', name)::text from storage.objects"
parameters: list[str] = []
if len(sys.argv) > 1:
    placeholders = ",".join(f"${index}" for index in range(1, len(sys.argv)))
    query += f" where bucket_id in ({placeholders})"
    parameters = sys.argv[1:]
query += " order by bucket_id, name"

# psql variable binding is deliberately avoided: bucket filters are restricted below.
if parameters:
    for bucket in parameters:
        if not bucket.replace("-", "").isalnum():
            raise SystemExit(f"Invalid bucket filter: {bucket}")
    quoted_buckets = ",".join("'" + bucket.replace("'", "''") + "'" for bucket in parameters)
    query = (
        "select json_build_object('bucket', bucket_id, 'name', name)::text "
        f"from storage.objects where bucket_id in ({quoted_buckets}) order by bucket_id, name"
    )

result = subprocess.run(
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
        "--set",
        "ON_ERROR_STOP=1",
        "--command",
        query,
    ],
    text=True,
    capture_output=True,
    check=True,
)
objects = [json.loads(line) for line in result.stdout.splitlines() if line.strip()]

headers_base = {
    "apikey": service_key,
    "Authorization": f"Bearer {service_key}",
    "x-upsert": "true",
}
copied_bytes = 0
missing_source_objects: list[str] = []
start_index = int(os.environ.get("STORAGE_COPY_START_INDEX", "1"))

for index, item in enumerate(objects, start=1):
    if index < start_index:
        continue
    bucket = item["bucket"]
    name = item["name"]
    try:
        head = source.head_object(Bucket=bucket, Key=name)
    except ClientError as error:
        status = error.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
        if status == 404:
            opaque_id = hashlib.sha256(f"{bucket}/{name}".encode()).hexdigest()[:16]
            missing_source_objects.append(opaque_id)
            print(f"storage_source_missing={opaque_id}", flush=True)
            continue
        raise
    with tempfile.NamedTemporaryFile() as temporary_file:
        source.download_fileobj(bucket, name, temporary_file)
        temporary_file.flush()
        temporary_file.seek(0)
        source_hash = hashlib.sha256(temporary_file.read()).hexdigest()
        temporary_file.seek(0)

        destination_url = (
            f"{destination_base}/{quote(bucket, safe='')}/{quote(name, safe='/')}"
        )
        headers = dict(headers_base)
        headers["Content-Type"] = head.get("ContentType") or "application/octet-stream"
        if head.get("CacheControl"):
            headers["Cache-Control"] = head["CacheControl"]
        upload = requests.post(
            destination_url,
            headers=headers,
            data=temporary_file,
            timeout=(10, 600),
        )
        if upload.status_code not in (200, 201):
            raise RuntimeError(
                f"Upload failed for {bucket}/{name}: HTTP {upload.status_code}"
            )

        download = requests.get(
            destination_url,
            headers={
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
            },
            stream=True,
            timeout=(10, 600),
        )
        if download.status_code != 200:
            raise RuntimeError(
                f"Verification download failed for {bucket}/{name}: HTTP {download.status_code}"
            )
        destination_hasher = hashlib.sha256()
        for chunk in download.iter_content(chunk_size=1024 * 1024):
            destination_hasher.update(chunk)
        if destination_hasher.hexdigest() != source_hash:
            raise RuntimeError(f"Checksum mismatch for {bucket}/{name}")
        copied_bytes += int(head.get("ContentLength", 0))

    if index % 25 == 0 or index == len(objects):
        print(f"storage_progress={index}/{len(objects)}", flush=True)

print(f"storage_objects_copied={len(objects)}")
print(f"storage_bytes_copied={copied_bytes}")
print("storage_sha256_verified=true")
print(f"storage_source_missing_count={len(missing_source_objects)}")
if missing_source_objects:
    raise SystemExit(2)
