# Job Configuration & Rule Filtering Engine Specification

---

## 1. Job Schema Definition

### Execution Placement

```json
{
  "executionMode": "local | worker",
  "workerId": "paired-worker-uuid"
}
```

- Missing `executionMode` is interpreted as `local` for backward compatibility.
- `workerId` is required only for Worker execution.
- Worker jobs use idempotent leases; local jobs keep the existing scheduler path.
- Offline or `PAUSED_VPN` workers do not accumulate missed intervals.

Each Approval Job defines a scheduled automation rule that targets one or more repositories and evaluates open pull requests against strict safety criteria.

### 1.1. TypeScript Interface
```typescript
export interface ApprovalJob {
  id: string;                    // UUID v4
  name: string;                  // e.g. "Auto-approve Core Backend PRs"
  description?: string;          // Optional user note
  enabled: boolean;              // Master toggle
  intervalSeconds: number;       // Execution frequency (default: 60s, min: 10s)
  dryRun: boolean;               // When true: logs matches without approving
  rules: JobFilterRules;         // Filtering criteria
  lastRunAt?: string;            // ISO 8601 timestamp
  nextRunAt?: string;            // ISO 8601 timestamp
  createdAt: string;
  updatedAt: string;
}

export interface JobFilterRules {
  repositories: string[];        // Repository patterns (e.g., ["CORE/*", "FRONT/web-app"])
  authorWhitelist: string[];     // Authors eligible for auto-approval
  authorBlacklist?: string[];    // Authors explicitly forbidden from auto-approval
  excludeSelf: boolean;          // Reject PRs created by the token owner (default: true)
  targetBranches: string[];      // Target branch patterns (e.g., ["main", "develop", "release/*"])
  sourceBranches?: string[];     // Optional source branch patterns (e.g., ["feature/*", "bugfix/*"])
  titleKeywordsInclude?: string[];// Required title keywords (e.g., ["JIRA-"])
  titleKeywordsExclude?: string[];// Blocked title keywords (e.g., ["[WIP]", "[DO NOT MERGE]"])
  ignoreDrafts: boolean;         // Skip PRs flagged as draft (default: true)
  ignoreWithConflicts: boolean;  // Skip PRs that cannot merge cleanly (default: true)
  requireSuccessfulBuild?: boolean; // Wait for CI build green (default: false)
  minApprovalsNeeded?: number;   // E.g. approve only if at least 1 other reviewer approved
}
```

---

## 2. Rule Evaluation Engine Pipeline

When an open PR is evaluated by `RuleFilteringEngine.evaluate(pr, rules, currentUser)`, the following sequential checks are executed:

### Step 1: Self-Exclusion Check
- **Rule**: If `rules.excludeSelf === true` AND `pr.author.username.toLowerCase() === currentUser.username.toLowerCase()`:
  - **Result**: `FAIL` (Reason: `Author is the current user (self-exclusion enabled)`)

### Step 2: Author Blacklist Check
- **Rule**: If `rules.authorBlacklist` contains `pr.author.username`:
  - **Result**: `FAIL` (Reason: `Author '${pr.author.username}' is in blacklist`)

### Step 3: Author Whitelist Check
- **Rule**: Matches `pr.author.username` against `rules.authorWhitelist` using glob/exact matching:
  - Supports wildcards, e.g. `bot-*`, `partner-*`.
  - If no pattern matches:
    - **Result**: `FAIL` (Reason: `Author '${pr.author.username}' is not in whitelist`)

### Step 4: Repository Matching Check
- **Rule**: Evaluates `${pr.repository.projectOrWorkspace}/${pr.repository.slug}` against `rules.repositories`:
  - E.g., pattern `CORE/*` matches `CORE/api-service` and `CORE/worker`.
  - If no repository pattern matches:
    - **Result**: `FAIL` (Reason: `Repository does not match configured target list`)

### Step 5: Target Branch Check
- **Rule**: Evaluates `pr.targetBranch.name` against `rules.targetBranches`:
  - Glob examples: `main`, `master`, `develop`, `release/*`.
  - Regex examples (with `regex:` prefix): `regex:^(release|hotfix)\/v\d+\.\d+`.
  - If no pattern matches:
    - **Result**: `FAIL` (Reason: `Target branch '${pr.targetBranch.name}' does not match target branches`)

### Step 6: Source Branch Check (Optional)
- **Rule**: If `rules.sourceBranches` is provided and non-empty:
  - Evaluates `pr.sourceBranch.name` against the list.
  - If no pattern matches:
    - **Result**: `FAIL` (Reason: `Source branch '${pr.sourceBranch.name}' does not match source branch patterns`)

### Step 7: Draft Status Guard
- **Rule**: If `rules.ignoreDrafts === true` AND `pr.isDraft === true`:
  - **Result**: `FAIL` (Reason: `PR is marked as Draft / Work-in-Progress`)

### Step 8: Conflict Guard
- **Rule**: If `rules.ignoreWithConflicts === true` AND `pr.hasConflicts === true`:
  - **Result**: `FAIL` (Reason: `PR has unresolved merge conflicts`)

### Step 9: Title Keyword Exclusion
- **Rule**: If any keyword in `rules.titleKeywordsExclude` is present in `pr.title` (case-insensitive):
  - **Result**: `FAIL` (Reason: `Title contains excluded keyword '${keyword}'`)

### Step 10: Already Approved Check (Idempotency)
- **Rule**: Checks whether the current user is already listed in `pr.reviewers` with `isApproved === true`:
  - If already approved:
    - **Result**: `ALREADY_APPROVED` (Reason: `PR is already approved by current user`)

---

## 3. Decision Matrix Summary

| Check | Condition | Action |
|---|---|---|
| Self PR | `excludeSelf: true` & author == self | Skip with log |
| Author Blacklist | Author in blacklist | Skip with log |
| Author Whitelist | Author not in whitelist | Skip with log |
| Repo Match | Repo doesn't match pattern | Skip with log |
| Target Branch | Branch doesn't match | Skip with log |
| Source Branch | Specified & doesn't match | Skip with log |
| Draft PR | `ignoreDrafts: true` & `isDraft == true` | Skip with log |
| Conflicts | `ignoreWithConflicts: true` & conflicts present | Skip with log |
| Already Approved | Current user is reviewer with approved = true | Skip / no-op |
| All Passed | All criteria met & `dryRun == true` | Record `DRY_RUN` log & emit SSE |
| All Passed | All criteria met & `dryRun == false` | Call `POST approve`, record `APPROVED` log, emit SSE |

---

## 4. Pattern Matching Specification

The pattern engine uses a lightweight, zero-dependency glob matcher supporting:
1. `*`: Matches zero or more characters within a slash-delimited path segment.
2. `**`: Matches zero or more path segments.
3. `regex:<expression>`: Direct JavaScript RegExp match (e.g. `regex:^hotfix\/[A-Z]+-\d+`).
4. Case handling: Comparisons are case-insensitive by default.
