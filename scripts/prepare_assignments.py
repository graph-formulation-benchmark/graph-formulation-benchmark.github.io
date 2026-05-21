#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import shutil
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


def remove_unclear_options(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: remove_unclear_options(item) for key, item in value.items()}
    if isinstance(value, list):
        return [remove_unclear_options(item) for item in value if item != "Unclear"]
    return value


def normalize_schema(schema: Dict[str, Any]) -> Dict[str, Any]:
    active_objectives = json.loads(json.dumps(schema.get("active_objectives", {})))
    item_schema = active_objectives.get("item_schema", {})
    for removed_field in ["confidence", "evidence_spans"]:
        item_schema.pop(removed_field, None)
    keep = {
        "objective_taxonomy": schema.get("objective_taxonomy", []),
        "direction": schema.get("direction", {}),
        "weighting": schema.get("weighting", {}),
        "time_model": schema.get("time_model", {}),
        "node_meaning": schema.get("node_meaning", {}),
        "edge_meaning": schema.get("edge_meaning", {}),
        "active_objectives": active_objectives,
        "identified_objectives": schema.get("identified_objectives", active_objectives),
        "operations": schema.get("operations", schema.get("allowed_operations", {})),
        "allowed_operations": schema.get("allowed_operations", {}),
    }
    return remove_unclear_options(keep)


def public_assignment_item(row: Dict[str, Any], phase: str) -> Dict[str, Any]:
    if phase == "story_quality_ab":
        return {
            "story_quality_pair_id": row.get("story_quality_pair_id", ""),
            "genre": row.get("genre", ""),
            "requested_genre": row.get("requested_genre", ""),
            "context": row.get("context", {}),
            "story_A": row.get("story_A", ""),
            "story_B": row.get("story_B", ""),
            "instructions": row.get("instructions", "Read both stories and choose which is better as a benchmark item."),
        }
    if phase == "formulation_ab":
        return {
            "formulation_pair_id": row.get("formulation_pair_id", ""),
            "human_item_id": row.get("human_item_id", ""),
            "story_text": row.get("story_text", ""),
            "candidate_A": row.get("candidate_A", {}),
            "candidate_B": row.get("candidate_B", {}),
            "instructions": row.get("instructions", "Read the story and choose which candidate formulation is better supported."),
        }
    return {
        "human_item_id": row.get("human_item_id", ""),
        "story_text": row.get("story_text", ""),
        "instructions": row.get("instructions", "Read the story and infer the graph formulation. Do not use external resources or LLM tools."),
    }


def read_assignment_rows(path: Path) -> List[Dict[str, str]]:
    with path.open("r", encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def reset_dir(path: Path) -> None:
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True, exist_ok=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Prepare tokenized public survey assignments.")
    parser.add_argument("--human_eval_dir", required=True)
    parser.add_argument("--out", default="survey_web")
    parser.add_argument("--max_items_per_annotator", type=int, default=15)
    parser.add_argument("--phase", default="blind_recovery", help="Phase name or comma-separated phase names.")
    parser.add_argument(
        "--write_static_assignments",
        action="store_true",
        help="Also write token-named assignment JSON files under public/data/assignments. Do not use for public repos.",
    )
    return parser.parse_args()


def phase_config(phase: str, human_eval: Path) -> tuple[str, Path, Path]:
    if phase == "formulation_ab":
        return "formulation_pair_id", human_eval / "packets/formulation_ab_pairs.jsonl", human_eval / "forms/formulation_ab_form_schema.json"
    if phase == "story_quality_ab":
        return "story_quality_pair_id", human_eval / "packets/story_quality_ab_pairs.jsonl", human_eval / "forms/story_quality_ab_form_schema.json"
    return "human_item_id", human_eval / "packets/blind_recovery_items.jsonl", human_eval / "forms/blind_recovery_form_schema.json"


def main() -> int:
    args = parse_args()
    human_eval = Path(args.human_eval_dir)
    out = Path(args.out)
    public_data = out / "public/data"
    private = out / "private"
    public_data.mkdir(parents=True, exist_ok=True)
    private.mkdir(parents=True, exist_ok=True)

    phases = [phase.strip() for phase in args.phase.split(",") if phase.strip()]
    if not phases:
        raise SystemExit("At least one --phase is required.")
    phase_items: Dict[str, Dict[str, Dict[str, Any]]] = {}
    phase_item_keys: Dict[str, str] = {}
    schemas: Dict[str, Dict[str, Any]] = {}
    for phase in phases:
        item_key, packet_path, schema_path = phase_config(phase, human_eval)
        phase_item_keys[phase] = item_key
        phase_items[phase] = {row[item_key]: row for row in load_jsonl(packet_path)}
        schemas[phase] = json.loads(schema_path.read_text(encoding="utf-8"))
    objective_schema_path = human_eval / "forms/blind_recovery_form_schema.json"
    objective_schema = json.loads(objective_schema_path.read_text(encoding="utf-8")) if objective_schema_path.exists() else {}
    existing_taxonomy_path = public_data / "objective_taxonomy.json"
    if existing_taxonomy_path.exists():
        existing_taxonomy = json.loads(existing_taxonomy_path.read_text(encoding="utf-8"))
        if isinstance(existing_taxonomy, list) and existing_taxonomy:
            objective_schema["objective_taxonomy"] = existing_taxonomy
    assignments = read_assignment_rows(human_eval / "assignment/item_assignment.csv")

    first_phase = phases[0]
    write_json(public_data / "form_schema.json", normalize_schema(schemas[first_phase] if first_phase not in {"formulation_ab", "story_quality_ab"} else objective_schema))
    write_json(public_data / "objective_taxonomy.json", objective_schema.get("objective_taxonomy", []))

    by_phase_annotator: Dict[str, Dict[str, List[str]]] = {phase: {} for phase in phases}
    for row in assignments:
        phase = row.get("phase", "")
        if phase not in phase_items:
            continue
        item_key = phase_item_keys[phase]
        annotator = row.get("annotator_id", "")
        item_id = row.get(item_key, "")
        if not annotator or item_id not in phase_items[phase]:
            continue
        by_phase_annotator[phase].setdefault(annotator, []).append(item_id)

    token_rows: List[Dict[str, str]] = []
    seed_sql = ["-- Generated assignment tokens. Run after supabase_schema.sql."]
    for phase in phases:
        seed_sql.append(f"update study_tokens set active = false where assignment_id like {sql_literal(phase + '_%')};")
    seed_sql.append("insert into study_tokens (token_hash, annotator_id, assignment_id, active) values")
    values: List[str] = []
    assignment_seed_sql = ["-- Generated assignment payloads. Run after supabase_seed_tokens.sql."]
    for phase in phases:
        assignment_seed_sql.append(f"update survey_assignments set active = false where assignment_json->>'phase' = {sql_literal(phase)};")
    assignment_seed_sql.append("insert into survey_assignments (token_hash, assignment_json, active) values")
    assignment_values: List[str] = []
    for phase in phases:
        for annotator in sorted(by_phase_annotator[phase]):
            selected = by_phase_annotator[phase][annotator][: args.max_items_per_annotator]
            token = secrets.token_urlsafe(18)
            assignment_id = f"{phase}_{annotator}"
            payload = {
                "assignment_id": assignment_id,
                "annotator_id": annotator,
                "phase": phase,
                "items": [public_assignment_item(phase_items[phase][item_id], phase) for item_id in selected],
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
    parts_dir = private / "supabase_seed_assignments_parts"
    reset_dir(parts_dir)
    deactivate_lines = ["-- Run this first, after supabase_seed_tokens.sql."]
    for phase in phases:
        deactivate_lines.append(f"update survey_assignments set active = false where assignment_json->>'phase' = {sql_literal(phase)};")
    (parts_dir / "part_000_deactivate_old_assignments.sql").write_text("\n".join(deactivate_lines) + "\n", encoding="utf-8")
    for idx, value in enumerate(assignment_values, start=1):
        sql = (
            "-- Run after part_000_deactivate_old_assignments.sql.\n"
            "insert into survey_assignments (token_hash, assignment_json, active) values\n"
            f"{value}\n"
            "on conflict (token_hash) do update set assignment_json = excluded.assignment_json, active = excluded.active;\n"
        )
        (parts_dir / f"part_{idx:03d}.sql").write_text(sql, encoding="utf-8")
    print(f"Generated {len(token_rows)} tokenized assignments in {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
