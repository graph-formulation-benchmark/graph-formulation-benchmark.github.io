#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import secrets
from pathlib import Path
from typing import Any, Dict, List


def load_jsonl(path: Path) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
        f.write("\n")


def normalize_schema(schema: Dict[str, Any]) -> Dict[str, Any]:
    keep = {
        "objective_taxonomy": schema.get("objective_taxonomy", []),
        "direction": schema.get("direction", {}),
        "weighting": schema.get("weighting", {}),
        "time_model": schema.get("time_model", {}),
        "active_objectives": schema.get("active_objectives", {}),
        "allowed_operations": schema.get("allowed_operations", {}),
        "alternative_formulation_exists": schema.get("alternative_formulation_exists", {}),
        "overall_confidence": schema.get("overall_confidence", {}),
    }
    return keep


def read_assignment_rows(path: Path) -> List[Dict[str, str]]:
    with path.open("r", encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Prepare tokenized public survey assignments.")
    parser.add_argument("--human_eval_dir", required=True)
    parser.add_argument("--out", default="survey_web")
    parser.add_argument("--max_items_per_annotator", type=int, default=15)
    parser.add_argument("--phase", default="blind_recovery")
    parser.add_argument(
        "--write_static_assignments",
        action="store_true",
        help="Also write token-named assignment JSON files under public/data/assignments. Do not use for public repos.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    human_eval = Path(args.human_eval_dir)
    out = Path(args.out)
    public_data = out / "public/data"
    private = out / "private"
    public_data.mkdir(parents=True, exist_ok=True)
    private.mkdir(parents=True, exist_ok=True)

    items = {row["human_item_id"]: row for row in load_jsonl(human_eval / "packets/blind_recovery_items.jsonl")}
    schema = json.loads((human_eval / "forms/blind_recovery_form_schema.json").read_text(encoding="utf-8"))
    assignments = read_assignment_rows(human_eval / "assignment/item_assignment.csv")

    write_json(public_data / "form_schema.json", normalize_schema(schema))
    write_json(public_data / "objective_taxonomy.json", schema.get("objective_taxonomy", []))

    by_annotator: Dict[str, List[str]] = {}
    for row in assignments:
        if row.get("phase") != args.phase:
            continue
        annotator = row.get("annotator_id", "")
        item_id = row.get("human_item_id", "")
        if not annotator or item_id not in items:
            continue
        by_annotator.setdefault(annotator, []).append(item_id)

    token_rows: List[Dict[str, str]] = []
    seed_sql = [
        "-- Generated assignment tokens. Run after supabase_schema.sql.",
        "insert into study_tokens (token_hash, annotator_id, assignment_id, active) values",
    ]
    values: List[str] = []
    assignment_seed_sql = [
        "-- Generated assignment payloads. Run after supabase_seed_tokens.sql.",
        "insert into survey_assignments (token_hash, assignment_json, active) values",
    ]
    assignment_values: List[str] = []
    for annotator in sorted(by_annotator):
        selected = by_annotator[annotator][: args.max_items_per_annotator]
        token = secrets.token_urlsafe(18)
        assignment_id = f"{args.phase}_{annotator}"
        payload = {
            "assignment_id": assignment_id,
            "annotator_id": annotator,
            "phase": args.phase,
            "items": [items[item_id] for item_id in selected],
        }
        h = token_hash(token)
        if args.write_static_assignments:
            write_json(public_data / "assignments" / f"{token}.json", payload)
        token_rows.append(
            {
                "annotator_id": annotator,
                "assignment_id": assignment_id,
                "token": token,
                "token_hash": h,
                "url_path": f"?token={token}",
                "num_items": str(len(selected)),
            }
        )
        values.append(f"({sql_literal(h)}, {sql_literal(annotator)}, {sql_literal(assignment_id)}, true)")
        payload_json = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        assignment_values.append(f"({sql_literal(h)}, {sql_literal(payload_json)}::jsonb, true)")

    with (private / "assignment_tokens.csv").open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["annotator_id", "assignment_id", "token", "token_hash", "url_path", "num_items"])
        writer.writeheader()
        writer.writerows(token_rows)

    if values:
        seed_sql.append(",\n".join(values) + "\n" + "on conflict (token_hash) do update set active = excluded.active;")
    else:
        seed_sql.append("-- no assignment tokens generated")
    (private / "supabase_seed_tokens.sql").write_text("\n".join(seed_sql) + "\n", encoding="utf-8")

    if assignment_values:
        assignment_seed_sql.append(
            ",\n".join(assignment_values)
            + "\n"
            + "on conflict (token_hash) do update set assignment_json = excluded.assignment_json, active = excluded.active;"
        )
    else:
        assignment_seed_sql.append("-- no assignment payloads generated")
    (private / "supabase_seed_assignments.sql").write_text("\n".join(assignment_seed_sql) + "\n", encoding="utf-8")
    print(f"Generated {len(token_rows)} tokenized assignments in {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
