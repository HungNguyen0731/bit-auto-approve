# Bitbucket PR Auto-Approver: Combobox Interaction Specification
## High-Performance Searchable Multi-Select Comboboxes (Light Theme & Bitbucket Cloud Standard)

---

## 1. Overview & Problem Statement

Job filters previously relied on a plain text `TagInput` requiring users to memorize and manually type exact repository slugs, branch names, and usernames without validation or live autocomplete.

This specification details the **Dynamic Searchable Multi-Select Combobox** in professional **Light Theme**, engineered for instant search, live Bitbucket Cloud API v2.0 metadata hydration, keyboard navigation, and tactile chip management.

---

## 2. Component Anatomy & Visual Layout (Light Theme)

```
+---------------------------------------------------------------------------------------------------+
| LABEL: Repositories to Monitor *                                            (Select from Bitbucket) |
+---------------------------------------------------------------------------------------------------+
|  [ payment-service (x) ] [ auth-* (x) ]  | Type to search repos or wildcard...                  v |
+---------------------------------------------------------------------------------------------------+
| POPUP POPOVER (bg-white, border-slate-200, shadow-lg, max-h-[280px], rounded-xl)                 |
|  -----------------------------------------------------------------------------------------------  |
|  * Match Wildcard Option:                                                                         |
|    [+] Add "auth-*" as wildcard pattern                                                           |
|  -----------------------------------------------------------------------------------------------  |
|  * Bitbucket Cloud Repositories:                                                                  |
|    [x] [PAY] payment-service        Core payment processing pipeline  [Private] [main]            |
|    [ ] [AUTH] auth-gateway          OAuth & SAML service              [Private] [master]          |
|    [ ] [WEB] checkout-frontend      Customer checkout application     [Private] [main]            |
|  -----------------------------------------------------------------------------------------------  |
|  Showing 3 of 42 repositories                                               [Clear All] [Select All] |
+---------------------------------------------------------------------------------------------------+
```

---

## 3. Specialized Entity Comboboxes (Bitbucket Cloud)

### 3.1. Repositories Combobox
- **Source API**: `GET /api/bitbucket/repositories?workspace={ws}&query={q}&limit=25`
- **Light Theme Item Rendering**:
  - Left: Project key badge (e.g. `[PAY]`, `bg-slate-100 text-slate-700 border border-slate-200 rounded px-1.5 py-0.5 text-[10px] font-mono font-bold`).
  - Center: Repository name (`text-xs font-semibold text-slate-900`) + description (`text-[11px] text-slate-500 truncate`).
  - Right: Lock icon for private repos, default branch badge (`text-[10px] font-mono bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.2 rounded`).
- **Wildcard Creation**:
  - If query contains `*` (e.g. `payment-*` or `*-service`), top item in dropdown displays:
    `Add "${query}" as wildcard match rule`.
- **Selected Tag Chip (Light Theme)**:
  - Base: `bg-slate-100 border border-slate-200 text-slate-800 rounded-lg px-2 py-1 text-xs flex items-center gap-1.5`.
  - Wildcard chip: `bg-amber-50 border border-amber-200 text-amber-800`.
  - Dismiss: `hover:bg-slate-200 rounded p-0.5 transition-colors`.
  - Long values remain on one line and truncate within the combobox width; the full value remains available to assistive technology and in the option list.
  - Large selections show the first three chips plus an operable `+N selected` disclosure. `Show less` restores the compact state without changing selected values.
  - The repository footer offers `Select all` for the currently loaded result set and `Select matching` when a search query is active.

### 3.2. Target & Source Branches Combobox
- **Source API**: `GET /api/bitbucket/branches?repository={repo}&query={q}&limit=50`
- **Categorized Sections**:
  1. **Standard Default Branches**: `main`, `master`, `develop` (badge `bg-blue-50 text-blue-700 border-blue-200`).
  2. **Release Branches**: `release/*` (badge `bg-purple-50 text-purple-700 border-purple-200`).
  3. **Feature & Fix Branches**: `feature/*`, `bugfix/*` (badge `bg-emerald-50 text-emerald-700 border-emerald-200`).
- **Wildcard Support**: Allows entering `release/*` or `feature/*` as wildcard approval filters.

### 3.3. Authors Combobox (Workspace Collaborators)
- **Source API**: `GET /api/bitbucket/users?workspace={ws}&query={q}&limit=25`
- **Light Theme Item Rendering**:
  - Left: User avatar (24x24px rounded image from Atlassian Gravatar/CDN, or deterministic colored initials badge).
  - Center: Display name (`text-xs font-semibold text-slate-900`) + `@username` (`font-mono text-[11px] text-slate-500`).
  - Right: Atlassian Account ID indicator or Member pill.
- **Special Values**:
  - `*` (Wildcard: Approve for all authors).
- **Selected Tag Chip**:
  - Includes 16px mini avatar + Display name + remove `X`.

---

## 4. Keyboard Navigation & WAI-ARIA 1.2 Standards

| Key Stroke | Context | Resulting Action |
|------------|---------|------------------|
| **Arrow Down** | Input focused / Popover open | Move visual highlight to the next available option item. |
| **Arrow Up** | Input focused / Popover open | Move visual highlight to previous item; cycles back to input. |
| **Enter** | Item highlighted | Toggle selection of highlighted option (add or remove from chips). |
| **Space** | Focused on option | Toggle checkbox without closing dropdown. |
| **Escape** | Popover open | Immediately close popover and return focus to input. |
| **Backspace** | Input query is empty | Delete the most recently selected chip (last item). |
| **Tab** | Popover open | Close popover and advance focus to the next form element. |

### ARIA Attributes:
- Input element:
  - `role="combobox"`
  - `aria-expanded="true | false"`
  - `aria-haspopup="listbox"`
  - `aria-autocomplete="list"`
  - `aria-controls="combobox-options-list"`
  - `aria-activedescendant="option-{id}"`
- Options container:
  - `role="listbox"`
  - `aria-multiselectable="true"`
- Individual option item:
  - `role="option"`
  - `aria-selected="true | false"`

---

## 5. Loading, Empty & Error States

### 5.1. Loading State (Light Shimmer)
- While query is fetching from Bitbucket Cloud API:
  - Dropdown renders 3 skeleton rows: `bg-slate-100 animate-pulse h-8 rounded-lg mb-1.5`.

### 5.2. Empty State
- If search returns 0 results:
  - Displays centered message: `"No repositories matching '{query}' found in workspace {workspace}."`
  - Offers immediate fallback button: `Use "{query}" as custom wildcard pattern`.

### 5.3. Error State (Zero Mock, Proactive Diagnostics)
- If API call fails (e.g. HTTP 429 rate limit or HTTP 401 token expired):
  - Popover renders light error banner:
    * `bg-red-50 border border-red-200 text-red-700 text-xs p-3 rounded-lg flex items-center justify-between`
    * Diagnostic text: `"Rate limit reached. Retry in 24s."`
    * `Retry` button to re-fetch without closing modal.
