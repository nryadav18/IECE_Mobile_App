# Bulk Onboarding — Schools, Team Leaders & Trainers

Everything needed to collect user details on a spreadsheet and turn them into live logins.

## Folders

| Folder | What goes in it |
|---|---|
| `templates/` | The blank sheets you send out. Regenerate with `node onboarding/generate_templates.js`. |
| `data/` | Filled sheets that come back. Drop them here with their original file names. |
| `output/` | Auto-generated credential sheets (one per run). Git-ignored — they contain passwords. |

## The order matters

Schools must exist before team leaders can be attached to them, and both must exist
before trainers can be attached. Always run:

```
1. node create_schools_chairmen.js
2. node create_team_leaders.js
3. node create_trainers.js
```

## Full workflow

**1. Generate and send the templates**

```bash
cd backend
node onboarding/generate_templates.js
```

Send `templates/1_Schools_And_Chairmen.xlsx` to whoever collects school details,
`2_Team_Leaders.xlsx` and `3_Trainers.xlsx` to whoever collects staff details.
Each heading carries its own example in brackets, and the yellow columns are the
ones that must match existing records exactly.

**2. Save the filled sheets**

Put them in `backend/onboarding/data/` using the same file names. (Or pass any path
as an argument — see below.)

**3. Validate before writing anything**

```bash
node create_schools_chairmen.js --dry-run
```

This reads and checks every row, reports what would be created and what would fail,
and writes nothing to the database. Fix the sheet, re-run until clean.

**4. Create the accounts**

```bash
node create_schools_chairmen.js
node create_team_leaders.js
node create_trainers.js
```

Each script prints every new login as a copy-pasteable block, and saves the same list
to `output/<role>_credentials_<date>.xlsx` to hand out.

## Default passwords

| Role | Default |
|---|---|
| Chairman | `School@2026` |
| Team Leader | `TeamLeader@2026` |
| Trainer | `Trainer@2026` |

Leave the Password column blank in the sheet and the default is applied. If someone
types a password into that column, that one is used instead (minimum 6 characters).
Users change their own password after first login.

## How matching works

- **Team Leader → School** is matched on **school name**.
- **Trainer → School** is matched on **school name**.
- **Trainer → Team Leader** is matched on **team leader email** (email, not name,
  because two leaders can share a name).

Matching ignores letter case, leading/trailing spaces and double spaces — but nothing
else. `St. Xavier's` will not match `St Xaviers`. The safest habit is to copy-paste
school names out of the Schools sheet rather than retyping them. When a name does not
match, the script suggests the closest existing names in its error output.

## Useful details

- **Re-running is safe.** A row whose email is already registered is reported as
  *skipped*, never duplicated. So if 40 of 50 rows succeed, fix the 10 bad rows and
  re-run the same file — only the 10 get created.
- **Pass any file path:** `node create_trainers.js "C:\Users\me\Downloads\trainers.xlsx"`
- **`.csv` files work too**, in case someone sends one instead of `.xlsx`.
- **Association Year is computed**, not typed. You enter the association *start date*
  (DD-MM-YYYY) and the script derives `1st-year` / `2nd-year` / … from it, and stores
  the start date on the school as well.
- **Extra rows/columns are tolerated.** The scripts locate the heading row and map
  columns by name, so an added notes column will not break them. Do not rename or
  delete the existing headings, though.
- **Exit code is 1 if any row failed**, so this can be wired into a script safely.
