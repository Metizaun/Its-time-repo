#!/usr/bin/env python3
import os
import subprocess

import boto3
from botocore.config import Config


def read_env(path: str) -> dict[str, str]:
    values: dict[str, str] = {}
    with open(path, encoding="utf-8") as env_file:
        for raw_line in env_file:
            line = raw_line.rstrip("\r\n")
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key] = value
    return values


install_dir = os.environ.get("SUPABASE_INSTALL_DIR", "/opt/supabase-selfhost")
values = read_env(os.path.join(install_dir, ".env"))
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

client = boto3.client(
    "s3",
    endpoint_url=f"http://{gateway_ip}:8000/storage/v1/s3",
    region_name=values["REGION"],
    aws_access_key_id=values["S3_PROTOCOL_ACCESS_KEY_ID"],
    aws_secret_access_key=values["S3_PROTOCOL_ACCESS_KEY_SECRET"],
    config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
)
response = client.list_buckets()
print(f"storage_s3_ok=true buckets={len(response.get('Buckets', []))}")
