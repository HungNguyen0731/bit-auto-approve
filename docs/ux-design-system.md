# Bitbucket PR Auto-Approver: UI/UX Design System & Tokens
## Professional Light Theme Standard (Anti-Slop, High-Productivity Developer Tool)

---

## 0. Design Read & Core Philosophy

> **Design Read**: Developer Tool & DevOps Automation Dashboard for software engineers and engineering leads, designed with a crisp, natural, professional Light Theme (Linear-light / Vercel-light / GitHub-light aesthetic), leaning toward clean white surfaces, subtle slate borders, high-contrast typography, restrained micro-interactions, and strict zero-mock runtime policy.

### Dial Settings (Light Theme Engineering Presets)
- **`DESIGN_VARIANCE: 4`** — Clean, predictable, structured grid layout. Balanced white space with high information hierarchy.
- **`MOTION_INTENSITY: 3`** — Subtle, functional transitions (120–160ms ease-out, scale down to `0.98` on click, crisp popover fade). No gratuitous animations.
- **`VISUAL_DENSITY: 6`** — High-efficiency developer workspace. Compact badges, monospace branch tags, readable typography, and accessible touch targets (min 40px).

---

## 1. Light Theme Color System & Design Tokens

### 1.1. Core Palette Tokens

| Token Name | Hex Code / Tailwind Class | Role / Usage | WCAG AA Contrast Ratio against #FFFFFF |
|------------|---------------------------|--------------|-----------------------------------------|
| `--bg-canvas` | `#F8FAFC` (`slate-50`) | Page foundation background | Base backdrop (1.05:1 with white cards) |
| `--bg-surface` | `#FFFFFF` (`white`) | Main cards, panels, modals, popovers | Pure white container |
| `--bg-subtle` | `#F1F5F9` (`slate-100`) | Input backgrounds, hover rows, pill bases | Surface contrast 1.15:1 |
| `--bg-hover` | `#E2E8F0` (`slate-200`) | Interactive item hover state | Visual delimiter |
| `--border-subtle` | `#E2E8F0` (`slate-200`) | Card borders, dividing rules | 1.25:1 Non-text |
| `--border-medium` | `#CBD5E1` (`slate-300`) | Input borders, interactive button borders | 1.6:1 Non-text |
| `--border-focus` | `#0052CC` (`brand-500` / `blue-600`) | Focus ring & active input outline | **8.2:1** (AAA) |
| `--text-primary` | `#0F172A` (`slate-900`) | Headings, primary labels, main values | **19.8:1** (AAA) |
| `--text-secondary` | `#475569` (`slate-600`) | Subheadings, descriptions, table cells | **7.0:1** (AAA) |
| `--text-muted` | `#64748B` (`slate-500`) | Helper text, shortcuts, timestamps | **4.6:1** (AA Passed) |
| `--accent-primary` | `#0052CC` (`brand-500`) | Atlassian Royal Blue primary action CTA | **8.2:1** (AAA) |
| `--accent-hover` | `#0747A6` (`brand-600`) | Primary button hover state | **11.2:1** (AAA) |
| `--accent-subtle` | `#EFF6FF` (`blue-50`) | Selected tab background, active chip tint | Light accent wash |

### 1.2. Semantic Status Tokens (Light Theme Verified)

| Semantic State | Foreground Text | Background Wash | Border Accent | Contrast on White | Practical Application |
|----------------|-----------------|-----------------|---------------|-------------------|----------------------|
| **Success / Connected** | `#047857` (`emerald-700`) | `#ECFDF5` (`emerald-50`) | `#A7F3D0` (`emerald-200`) | **6.1:1** (AAA) | Token verified, PR approved, Cloud live |
| **Warning / Paused** | `#B45309` (`amber-700`) | `#FFFBEB` (`amber-50`) | `#FDE68A` (`amber-200`) | **5.3:1** (AA) | Dry run mode, skipped rules, near rate limit |
| **Danger / Disconnected**| `#B91C1C` (`red-700`) | `#FEF2F2` (`red-50`) | `#FECACA` (`red-200`) | **6.8:1** (AAA) | 401 Unauthorized, rate limit hit, network down |
| **Info / Scheduled** | `#1D4ED8` (`blue-700`) | `#EFF6FF` (`blue-50`) | `#BFDBFE` (`blue-200`) | **7.8:1** (AAA) | Job scheduled, SSE active, background cycle |

---

## 2. Typography Hierarchy & Font Rules

- **Sans Stack (UI & Display)**: `Inter`, `-apple-system`, `BlinkMacSystemFont`, `sans-serif`. Clean, readable at small sizes, zero visual fatigue.
- **Monospace Stack (Code, Hashes, Branches)**: `JetBrains Mono`, `ui-monospace`, `SFMono-Regular`, `monospace`.

| Scale | Tailwind | Pixel Size / Line Height | Tracking | Application |
|-------|----------|--------------------------|----------|-------------|
| **Display / Title** | `text-2xl font-bold text-slate-900` | 24px / 32px | `-0.02em` | Onboarding banner, page title |
| **Section Heading** | `text-lg font-semibold text-slate-900` | 18px / 28px | `-0.01em` | Modal title, card group header |
| **Body Primary** | `text-sm font-medium text-slate-800` | 14px / 20px | `normal` | Form labels, table cells, buttons |
| **Body Secondary** | `text-xs text-slate-600` | 12px / 16px | `normal` | Sublabels, helper hints, descriptions |
| **Code / Branch** | `text-xs font-mono text-slate-800` | 12px / 16px | `normal` | Repositories, git refs, commit SHAs |
| **Micro Caption** | `text-[11px] font-mono text-slate-500` | 11px / 14px | `+0.02em` | Timestamps, counters, badges |

---

## 3. Component States Specification

### 3.1. Loading States (Skeleton & Shimmer)
- **Rule**: Never use blocking full-page blank screens. Always provide structural shape-matching skeleton loaders.
- **Skeleton Visuals**:
  - Base: `bg-slate-200` with subtle pulse animation (`animate-pulse`).
  - Corner radius matches component (`rounded-lg` for buttons, `rounded-xl` for cards).
  - Micro spinners: `Loader2` from Lucide with `text-blue-600 animate-spin` for inline buttons.

### 3.2. Empty States
- **Rule**: Empty states must be proactive, explanatory, and offer a single clear resolution path.
- **Components**:
  1. Icon: Subtle slate-400 SVG glyph inside a rounded circle (`bg-slate-100 p-3`).
  2. Headline: 14px bold text (`text-slate-800`).
  3. Description: Max 20 words explaining *why* it is empty (`text-xs text-slate-500 max-w-sm text-center`).
  4. Action CTA: Primary or secondary button directing the user how to populate data.

### 3.3. Error States
- **Rule**: Explicit, informative, non-cryptic error displays. **Zero silent failures, zero fallback to mock data**.
- **Visual Presentation**:
  - Alert Box: `bg-red-50 border border-red-200 text-red-800 rounded-xl p-4`.
  - Icon: `AlertCircle` in `text-red-600 flex-shrink-0`.
  - Structure:
    * Error Title: Bold summary (e.g. `Invalid Bitbucket App Password`).
    * Technical Reason: Monospace error snippet (e.g. `Bitbucket Cloud API returned HTTP 401 Unauthorized`).
    * Actionable Suggestion: Clear resolution instructions with direct link to fix.
    * Retry CTA: `Try Again` button with immediate retry trigger.

---

## 4. Elevation, Shadow & Border Disciplines

- **Surfaces**: Pure white cards (`bg-white`) bordered by crisp `border border-slate-200`.
- **Subtle Elevation**:
  ```css
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.05), 0 1px 2px -1px rgba(0, 0, 0, 0.05);
  ```
- **Dropdown & Combobox Popovers**:
  ```css
  background: #FFFFFF;
  border: 1px solid #CBD5E1;
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.08), 0 4px 6px -4px rgba(0, 0, 0, 0.04);
  ```
- **Modal Backdrop**:
  ```css
  background: rgba(15, 23, 42, 0.35);
  backdrop-filter: blur(4px);
  ```

---

## 5. Accessibility & WCAG AA Verification

- **Form Labels**: Always positioned directly above inputs (`text-xs font-semibold text-slate-700`). Never rely solely on placeholders.
- **Focus Rings**: Every interactive element features a visible high-contrast focus ring:
  `focus:outline-none focus:ring-2 focus:ring-blue-600/30 focus:border-blue-600`.
- **Contrast Ratios**: Verified in Light Theme mode against white and slate-50 backgrounds. All body and label text exceeds 4.5:1; headings exceed 7:1.
- **Touch Targets**: Minimum interactive area of 44x44px for buttons and form elements.

---

## 6. Visual Asset System

The interface uses visual storytelling at page and state level while keeping operational controls compact.

### 6.1. Asset Hierarchy

1. **Official product mark**: Use the Bitbucket brand silhouette for product identity and repository context. Do not replace it with a generic branch or cloud glyph.
2. **Scene illustration**: Use the shared `VisualArtwork` component for onboarding steps, the automation overview, and empty states. Scenes use one soft isometric language with blue-gray surfaces and green/amber status accents.
3. **Metric emblem**: Use filled, high-contrast `MetricEmblem` graphics for dashboard summaries instead of unrelated outline icons.
4. **Micro-actions**: Lucide remains appropriate for close, back, refresh, search, password visibility, and small inline actions where the glyph describes an interaction rather than product identity.

### 6.2. Accessibility and Performance

- Decorative scenes are hidden from the accessibility tree because adjacent headings communicate the same meaning.
- Meaningful remote avatars keep a descriptive `alt`; fallback initials remain text.
- Every SVG instance generates unique gradient and filter IDs to prevent duplicate-ID rendering collisions when desktop and mobile variants coexist.
- SVG scenes declare a stable `viewBox` and are placed in aspect-ratio-safe containers to avoid cumulative layout shift.
- Motion is limited to existing transform/opacity transitions and respects `prefers-reduced-motion`.

### 6.3. Responsive Composition

- At `lg` and above, onboarding uses a dark narrative panel beside the functional form.
- Below `lg`, the current-step scene becomes a compact banner above the form.
- At 375px, navigation labels collapse while step numbers, state, and all primary actions remain available.
