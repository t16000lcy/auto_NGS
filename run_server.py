from __future__ import annotations

import csv
import json
import mimetypes
import os
import secrets
import shlex
import subprocess
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).resolve().parent
CONFIG_PATH = ROOT / "vep_config.json"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
API_TOKEN = secrets.token_urlsafe(32)
API_TOKEN_HEADER = "X-CMUHCH-VEP-Token"
MAX_JSON_BODY_BYTES = 5 * 1024 * 1024
MAX_VEP_INPUTS = 5000


def load_config() -> dict:
    with CONFIG_PATH.open("r", encoding="utf-8") as handle:
        config = json.load(handle)
    config["host_data_dir"] = str(Path(config["host_data_dir"]))
    config["jobs_dir"] = str((ROOT / config["jobs_dir"]).resolve())
    config["audit_dir"] = str((ROOT / config.get("audit_dir", "data/audit_logs")).resolve())
    return config


def allowed_origins() -> set[str]:
    port = int(os.environ.get("CMUHCH_VEP_PORT", DEFAULT_PORT))
    configured = {
        item.strip().rstrip("/")
        for item in os.environ.get("CMUHCH_VEP_ALLOWED_ORIGINS", "").split(",")
        if item.strip()
    }
    return configured | {
        f"http://{DEFAULT_HOST}:{port}",
        f"http://localhost:{port}",
        f"http://127.0.0.1:{port}",
    }


def is_allowed_origin(origin: str | None) -> bool:
    return not origin or origin in allowed_origins()


def add_cors_headers(handler: BaseHTTPRequestHandler) -> None:
    origin = handler.headers.get("Origin")
    if is_allowed_origin(origin) and origin:
        handler.send_header("Access-Control-Allow-Origin", origin)
        handler.send_header("Vary", "Origin")
    handler.send_header("Access-Control-Allow-Headers", f"Content-Type, {API_TOKEN_HEADER}")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")


def json_response(handler: BaseHTTPRequestHandler, status: int, payload: dict) -> None:
    body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    add_cors_headers(handler)
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def error_response(handler: BaseHTTPRequestHandler, status: int, message: str) -> None:
    json_response(handler, status, {"ok": False, "error": message})


def is_api_path(path: str) -> bool:
    return path.startswith("/api/")


def is_authorized_api_request(handler: BaseHTTPRequestHandler) -> bool:
    if not is_allowed_origin(handler.headers.get("Origin")):
        return False
    return handler.headers.get(API_TOKEN_HEADER) == API_TOKEN


def run_command(args: list[str], timeout: int = 20) -> dict:
    try:
        completed = subprocess.run(
            args,
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        return {
            "ok": completed.returncode == 0,
            "returncode": completed.returncode,
            "stdout": completed.stdout.strip(),
            "stderr": completed.stderr.strip(),
        }
    except FileNotFoundError as exc:
        return {"ok": False, "returncode": None, "stdout": "", "stderr": str(exc)}
    except subprocess.TimeoutExpired as exc:
        return {"ok": False, "returncode": None, "stdout": exc.stdout or "", "stderr": "Command timed out"}


def vep_status() -> dict:
    config = load_config()
    runner = config.get("vep_runner", "docker")
    host_data_dir = Path(config["host_data_dir"])
    jobs_dir = Path(config["jobs_dir"])
    docker = run_command(["docker", "--version"])
    image = run_command(["docker", "image", "inspect", config["docker_image"]])
    wsl_base = ["wsl"]
    if config.get("wsl_distro"):
        wsl_base.extend(["-d", config["wsl_distro"]])
    if config.get("wsl_user"):
        wsl_base.extend(["-u", config["wsl_user"]])
    wsl = run_command([*wsl_base, "bash", "-lc", "printf 'WSL '; uname -sr"], timeout=10)
    wsl_vep = run_command([*wsl_base, "bash", "-lc", f"test -f {shlex.quote(config.get('wsl_vep_script', '$HOME/ensembl-vep/vep'))} && perl {shlex.quote(config.get('wsl_vep_script', '$HOME/ensembl-vep/vep'))} --help | head -n 1"], timeout=20)

    cache_dir = host_data_dir / "cache"
    fasta_dir = host_data_dir / "fasta"
    cache_ready = cache_has_grch38_refseq(cache_dir)
    fasta_ready = any(fasta_dir.glob("*.fa*")) or any(cache_dir.glob("**/*.fa*"))
    plugin_checks = plugin_status(config)
    checks = [
        {"name": "VEP runner", "ok": runner in ("docker", "wsl_source"), "detail": runner},
        {
            "name": "Docker CLI",
            "ok": runner != "docker" or docker["ok"],
            "detail": (docker["stdout"] or docker["stderr"]) if runner == "docker" else f"skipped; runner={runner}",
        },
        {
            "name": "VEP Docker image",
            "ok": runner != "docker" or image["ok"],
            "detail": config["docker_image"] if runner == "docker" else f"skipped; runner={runner}",
        },
        {"name": "WSL Linux", "ok": runner != "wsl_source" or wsl["ok"], "detail": f"{config.get('wsl_distro', 'default')}: {wsl['stdout'] or wsl['stderr']}"},
        {"name": "WSL VEP source", "ok": runner != "wsl_source" or wsl_vep["ok"], "detail": config.get("wsl_vep_script", "$HOME/ensembl-vep/vep")},
        {"name": "GRCh38 data folder", "ok": host_data_dir.exists(), "detail": str(host_data_dir)},
        {
            "name": "GRCh38 RefSeq cache",
            "ok": cache_ready,
            "detail": str(cache_dir / "homo_sapiens_refseq"),
        },
        {
            "name": "FASTA data",
            "ok": fasta_ready,
            "detail": f"{fasta_dir}; also checked cache subfolders",
        },
        {"name": "Job folder", "ok": True, "detail": str(jobs_dir)},
        *plugin_checks,
    ]

    return {"ok": all(item["ok"] for item in checks), "config": config, "checks": checks}


def cache_has_grch38_refseq(cache_dir: Path) -> bool:
    refseq_dir = cache_dir / "homo_sapiens_refseq"
    if not refseq_dir.exists():
        return False
    return any(path.is_dir() and "GRCh38" in path.name for path in refseq_dir.iterdir())


def plugin_status(config: dict) -> list[dict]:
    checks: list[dict] = []
    plugins = config.get("plugins", {})
    dbnsfp = plugins.get("dbnsfp", {})
    cadd = plugins.get("cadd", {})
    if dbnsfp:
        dbnsfp_path = Path(dbnsfp.get("host_path", ""))
        checks.append({
            "name": "dbNSFP plugin",
            "ok": (not dbnsfp.get("enabled")) or dbnsfp_path.exists(),
            "detail": f"{'enabled' if dbnsfp.get('enabled') else 'disabled'}; {dbnsfp_path}",
        })
    if cadd:
        snv_path = Path(cadd.get("snv_host_path", ""))
        indel_path = Path(cadd.get("indel_host_path", ""))
        checks.append({
            "name": "CADD plugin",
            "ok": (not cadd.get("enabled")) or (snv_path.exists() and indel_path.exists()),
            "detail": f"{'enabled' if cadd.get('enabled') else 'disabled'}; SNV={snv_path}; InDel={indel_path}",
        })
    return checks


def build_vep_command(config: dict, input_path: Path, output_path: Path) -> list[str]:
    if config.get("vep_runner") == "wsl_source":
        return build_wsl_vep_command(config, input_path, output_path)

    host_data_dir = Path(config["host_data_dir"])
    host_job_dir = input_path.parent
    input_in_container = f"/work/{input_path.name}"
    output_in_container = f"/work/{output_path.name}"

    command = [
        "docker",
        "run",
        "--rm",
        "-v",
        f"{host_data_dir}:{config['container_data_dir']}",
        "-v",
        f"{host_job_dir}:/work",
        config["docker_image"],
        "vep",
        "--species",
        config["species"],
        "--assembly",
        config["assembly"],
        "--dir_cache",
        config["cache_dir_in_container"],
        "--input_file",
        input_in_container,
        "--output_file",
        output_in_container,
    ]

    fasta_path = config.get("fasta_path_in_container")
    if fasta_path:
        command.extend(["--fasta", fasta_path])

    command.extend(config.get("vep_options", []))
    command.extend(build_plugin_options(config))
    return command


def windows_path_to_wsl(path: Path) -> str:
    resolved = path.resolve()
    drive = resolved.drive.rstrip(":").lower()
    parts = [part for part in resolved.parts[1:]]
    return f"/mnt/{drive}/" + "/".join(parts)


def build_wsl_vep_command(config: dict, input_path: Path, output_path: Path) -> list[str]:
    input_in_wsl = windows_path_to_wsl(input_path)
    output_in_wsl = windows_path_to_wsl(output_path)
    wsl_data_dir = config.get("wsl_data_dir", "/mnt/c/vep_data")
    cache_dir = f"{wsl_data_dir.rstrip('/')}/cache"
    vep_script = config.get("wsl_vep_script", "$HOME/ensembl-vep/vep")

    parts = [
        "perl",
        vep_script,
        "--species",
        config["species"],
        "--assembly",
        config["assembly"],
        "--dir_cache",
        cache_dir,
        "--input_file",
        input_in_wsl,
        "--output_file",
        output_in_wsl,
    ]

    fasta_path = config.get("wsl_fasta_path")
    if fasta_path:
        parts.extend(["--fasta", fasta_path])

    parts.extend(config.get("vep_options", []))
    parts.extend(build_wsl_plugin_options(config))
    shell_command = " ".join(shlex.quote(str(part)) for part in parts)
    command = ["wsl"]
    if config.get("wsl_distro"):
        command.extend(["-d", config["wsl_distro"]])
    if config.get("wsl_user"):
        command.extend(["-u", config["wsl_user"]])
    command.extend(["bash", "-lc", shell_command])
    return command


def build_wsl_plugin_options(config: dict) -> list[str]:
    options: list[str] = []
    plugins = config.get("plugins", {})
    dbnsfp = plugins.get("dbnsfp", {})
    if dbnsfp.get("enabled") and Path(dbnsfp.get("host_path", "")).exists():
        fields = ",".join(dbnsfp.get("fields", []))
        plugin_path = windows_path_to_wsl(Path(dbnsfp.get("host_path", "")))
        plugin_arg = f"dbNSFP,{plugin_path}"
        if fields:
            plugin_arg = f"{plugin_arg},{fields}"
        options.extend(["--plugin", plugin_arg])

    cadd = plugins.get("cadd", {})
    if (
        cadd.get("enabled")
        and Path(cadd.get("snv_host_path", "")).exists()
        and Path(cadd.get("indel_host_path", "")).exists()
    ):
        snv_path = windows_path_to_wsl(Path(cadd.get("snv_host_path", "")))
        indel_path = windows_path_to_wsl(Path(cadd.get("indel_host_path", "")))
        options.extend(["--plugin", f"CADD,snv={snv_path},indels={indel_path}"])
    return options


def build_plugin_options(config: dict) -> list[str]:
    options: list[str] = []
    plugins = config.get("plugins", {})
    dbnsfp = plugins.get("dbnsfp", {})
    if dbnsfp.get("enabled") and Path(dbnsfp.get("host_path", "")).exists():
        fields = ",".join(dbnsfp.get("fields", []))
        plugin_arg = f"dbNSFP,{dbnsfp.get('container_path')}"
        if fields:
            plugin_arg = f"{plugin_arg},{fields}"
        options.extend(["--plugin", plugin_arg])

    cadd = plugins.get("cadd", {})
    if (
        cadd.get("enabled")
        and Path(cadd.get("snv_host_path", "")).exists()
        and Path(cadd.get("indel_host_path", "")).exists()
    ):
        options.extend([
            "--plugin",
            f"CADD,snv={cadd.get('snv_container_path')},indels={cadd.get('indel_container_path')}",
        ])
    return options


def parse_vep_table(path: Path) -> list[dict]:
    if not path.exists():
        return []

    header = None
    rows: list[dict] = []
    with path.open("r", encoding="utf-8", errors="replace", newline="") as handle:
        for line in handle:
            if line.startswith("##"):
                continue
            if line.startswith("#"):
                header = line.lstrip("#").rstrip("\n").split("\t")
                continue
            if not header or not line.strip():
                continue
            values = next(csv.reader([line.rstrip("\n")], delimiter="\t"))
            rows.append({header[i]: values[i] if i < len(values) else "" for i in range(len(header))})
    return rows


def run_vep(inputs: list[str]) -> dict:
    config = load_config()
    cleaned = [item.strip() for item in inputs if str(item).strip()]
    if not cleaned:
        return {"ok": False, "error": "No VEP input provided"}
    if len(cleaned) > MAX_VEP_INPUTS:
        return {"ok": False, "error": f"Too many VEP inputs; maximum is {MAX_VEP_INPUTS}"}

    jobs_root = Path(config["jobs_dir"])
    jobs_root.mkdir(parents=True, exist_ok=True)
    job_id = time.strftime("%Y%m%d-%H%M%S")
    job_dir = jobs_root / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    input_path = job_dir / "input.hgvs.txt"
    output_path = job_dir / "vep_output.tsv"
    command_path = job_dir / "command.json"
    metadata_path = job_dir / "metadata.json"
    input_path.write_text("\n".join(cleaned) + "\n", encoding="utf-8")

    command = build_vep_command(config, input_path, output_path)
    command_path.write_text(json.dumps(command, ensure_ascii=False, indent=2), encoding="utf-8")
    metadata_path.write_text(
        json.dumps(
            {
                "job_id": job_id,
                "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                "vep_release": config.get("database_versions", {}).get("vep_release"),
                "assembly": config.get("assembly"),
                "database_versions": config.get("database_versions", {}),
                "plugins": config.get("plugins", {}),
                "input_count": len(cleaned),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    result = run_command(command, timeout=int(config.get("timeout_seconds", 1800)))
    records = parse_vep_table(output_path)

    return {
        "ok": result["ok"] and output_path.exists(),
        "job_id": job_id,
        "job_dir": str(job_dir),
        "input_count": len(cleaned),
        "output_path": str(output_path),
        "records": records[:200],
        "record_count": len(records),
        "command": command,
        "stdout": result["stdout"],
        "stderr": result["stderr"],
        "returncode": result["returncode"],
    }


def save_audit(payload: dict) -> dict:
    config = load_config()
    audit_dir = Path(config["audit_dir"])
    audit_dir.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    case_id = safe_name(str(payload.get("case_id") or "case"))
    audit_id = f"{stamp}-{case_id}"
    audit_path = audit_dir / f"{audit_id}.json"
    record = {
        "audit_id": audit_id,
        "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "operator": payload.get("operator", ""),
        "case_id": payload.get("case_id", ""),
        "panel": payload.get("panel", ""),
        "sample_adapter": payload.get("sample_adapter", ""),
        "parameters": payload.get("parameters", {}),
        "database_versions": config.get("database_versions", {}),
        "plugins": config.get("plugins", {}),
        "qc": payload.get("qc", {}),
        "report_candidates": payload.get("report_candidates", []),
        "manual_review": payload.get("manual_review", []),
        "summary": payload.get("summary", {}),
    }
    audit_path.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "audit_id": audit_id, "path": str(audit_path), "record": record}


def list_audits() -> dict:
    config = load_config()
    audit_dir = Path(config["audit_dir"])
    audit_dir.mkdir(parents=True, exist_ok=True)
    records = []
    for path in sorted(audit_dir.glob("*.json"), reverse=True)[:100]:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            records.append({
                "audit_id": data.get("audit_id", path.stem),
                "created_at": data.get("created_at", ""),
                "operator": data.get("operator", ""),
                "case_id": data.get("case_id", ""),
                "sample_adapter": data.get("sample_adapter", ""),
                "path": str(path),
            })
        except json.JSONDecodeError:
            continue
    return {"ok": True, "records": records}


def safe_name(value: str) -> str:
    cleaned = "".join(char if char.isalnum() or char in ("-", "_") else "_" for char in value)
    return cleaned[:80] or "case"


class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self) -> None:
        if not is_allowed_origin(self.headers.get("Origin")):
            self.send_response(403)
            self.end_headers()
            return
        self.send_response(204)
        add_cors_headers(self)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if is_api_path(parsed.path) and not is_authorized_api_request(self):
            error_response(self, 403, "Forbidden")
            return
        if parsed.path == "/api/vep/status":
            json_response(self, 200, vep_status())
            return
        if parsed.path == "/api/audit/list":
            json_response(self, 200, list_audits())
            return

        self.serve_static(parsed.path)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if is_api_path(parsed.path) and not is_authorized_api_request(self):
            error_response(self, 403, "Forbidden")
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            error_response(self, 400, "Invalid Content-Length")
            return
        if length > MAX_JSON_BODY_BYTES:
            error_response(self, 413, f"JSON body too large; maximum is {MAX_JSON_BODY_BYTES} bytes")
            return
        raw = self.rfile.read(length).decode("utf-8") if length else "{}"
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            json_response(self, 400, {"ok": False, "error": "Invalid JSON"})
            return

        if parsed.path == "/api/vep/run":
            json_response(self, 200, run_vep(payload.get("inputs", [])))
            return
        if parsed.path == "/api/audit/save":
            json_response(self, 200, save_audit(payload))
            return

        json_response(self, 404, {"ok": False, "error": "Not found"})

    def serve_static(self, request_path: str) -> None:
        relative = unquote(request_path.lstrip("/")) or "index.html"
        root = ROOT.resolve()
        path = (root / relative).resolve()
        try:
            path.relative_to(root)
        except ValueError:
            self.send_error(404)
            return
        if not path.exists() or not path.is_file():
            self.send_error(404)
            return

        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        body = path.read_bytes()
        if path.name == "index.html":
            injection = f'<script>window.CMUHCH_VEP_API_TOKEN = "{API_TOKEN}";</script>\n'
            body = body.replace(b'<script src="app.js"></script>', injection.encode("utf-8") + b'<script src="app.js"></script>')
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    host = os.environ.get("CMUHCH_VEP_HOST", DEFAULT_HOST)
    port = int(os.environ.get("CMUHCH_VEP_PORT", DEFAULT_PORT))
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"CMUHCH VEP server running at http://{host}:{port}/")
    print("Open the website through the server URL so the API token is injected into the page.")
    if os.environ.get("CMUHCH_VEP_ALLOWED_ORIGINS"):
        print(f"Allowed origins: {os.environ['CMUHCH_VEP_ALLOWED_ORIGINS']}")
    server.serve_forever()


if __name__ == "__main__":
    main()
