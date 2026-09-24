/**
 * Pattern Matcher supporting Glob wildcards (*, **) and Regex (prefix "regex:")
 */
export function matchesPattern(value: string, pattern: string, caseSensitive: boolean = false): boolean {
  if (!pattern || pattern.trim() === '') {
    return false;
  }

  const trimmedPattern = pattern.trim();
  const testVal = caseSensitive ? value : value.toLowerCase();

  // Pure Regex Pattern (e.g. "regex:^feature\\/JIRA-\\d+")
  if (trimmedPattern.startsWith('regex:')) {
    const regexBody = trimmedPattern.slice('regex:'.length);
    try {
      const flags = caseSensitive ? '' : 'i';
      const regex = new RegExp(regexBody, flags);
      return regex.test(value);
    } catch {
      // Invalid regex pattern, fallback to false
      return false;
    }
  }

  const targetPattern = caseSensitive ? trimmedPattern : trimmedPattern.toLowerCase();

  // Exact wildcard match
  if (targetPattern === '*' || targetPattern === '**') {
    return true;
  }

  // Exact equality
  if (targetPattern === testVal) {
    return true;
  }

  // Convert Glob to Regex
  // Escape special regex chars except * and ?
  const escaped = targetPattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '§§DOUBLE_STAR§§')
    .replace(/\*/g, '[^/]*')
    .replace(/§§DOUBLE_STAR§§/g, '.*')
    .replace(/\?/g, '.');

  try {
    const globRegex = new RegExp(`^${escaped}$`, caseSensitive ? '' : 'i');
    return globRegex.test(value);
  } catch {
    return false;
  }
}

/**
 * Check if a repository matches a repository rule (e.g. "CORE/*", "CORE/repo-slug", "*")
 */
export function matchesRepository(repoProjectAndSlug: string, patterns: string[]): boolean {
  if (!patterns || patterns.length === 0) {
    return false;
  }

  return patterns.some((pattern) => matchesPattern(repoProjectAndSlug, pattern));
}
