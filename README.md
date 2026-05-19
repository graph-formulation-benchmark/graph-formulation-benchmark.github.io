# GFM Human Eval Survey

Static GitHub Pages survey app for graph-formulation human evaluation. It supports blind formulation recovery and formulation A/B preference assignments.

Live app:

```text
https://graph-formulation-benchmark.github.io/?token=<assignment_token>
```

Repository:

```text
https://github.com/graph-formulation-benchmark/graph-formulation-benchmark.github.io
```

## Local Test

Open `public/index.html` in a browser, or serve it locally:

```bash
python -m http.server 8080 --directory public
```

Then visit:

```text
http://localhost:8080/?token=<assignment_token>
```

Tokens are generated into `private/assignment_tokens.csv`.

For the v3.1 pilot dry run, the generated assignment tokens are local-only in:

```text
private/assignment_tokens.csv
```

Share one URL per expert by appending that expert's token as the `token` query parameter.

The org Pages repository is public, so token-named assignment JSON files are not committed. Assignments are loaded from Supabase by token hash.

## Supabase Setup

1. Create a Supabase project.
2. Run `private/supabase_schema.sql` in the SQL editor.
3. Run `private/supabase_seed_tokens.sql` in the SQL editor.
4. Run `private/supabase_seed_assignments.sql` in the SQL editor.
5. Copy `public/config.example.js` to `public/config.js`.
6. Fill in `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
7. Commit and push `public/config.js` after configuration.

The public app includes only form options. Hidden keys, provider/status provenance, assignment tokens, and story packets are not committed into the public org Pages repository.

Assignment lookup uses the `get_survey_assignment(request_token_hash text)` Supabase RPC so direct public table reads do not expose all assignment packets.

The app keeps local autosave drafts and submits completed blind-recovery items to `blind_recovery_responses` and formulation A/B preference items to `formulation_ab_responses`. Experts can still export JSONL as a backup after the assignment loads.

To generate lower-burden formulation A/B verification assignments:

```bash
python scripts/prepare_assignments.py \
  --human_eval_dir ../human_eval_v31_pilot72 \
  --out . \
  --phase formulation_ab \
  --max_items_per_annotator 10
```

## Deploy To GitHub Pages

This repository uses the included GitHub Actions workflow in `.github/workflows/pages.yml`. It uploads `public/` as the Pages artifact.

The GitHub Pages site and repository are public under the organization namespace. Keep assignment tokens private and rotate/regenerate them for the real launch if a token URL is shared with the wrong person.
