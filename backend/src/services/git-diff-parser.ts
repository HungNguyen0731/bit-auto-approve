import type { GitDiffHunk, GitDiffLine, GitFileDiff } from '@bitbucket-pr-approver/shared';

/**
 * Parses raw unified git diff output into structured GitFileDiff objects
 */
export function parseGitDiff(rawDiff: string): GitFileDiff[] {
  if (!rawDiff || !rawDiff.trim()) {
    return [];
  }

  const files: GitFileDiff[] = [];
  const lines = rawDiff.split('\n');
  let currentFile: GitFileDiff | null = null;
  let currentHunk: GitDiffHunk | null = null;
  let curOldLine = 0;
  let curNewLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for start of a new file diff
    if (line.startsWith('diff --git ')) {
      if (currentHunk && currentFile) {
        currentFile.hunks.push(currentHunk);
        currentHunk = null;
      }
      if (currentFile) {
        files.push(currentFile);
      }

      // Format: diff --git a/path/to/file b/path/to/file
      const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      const oldPath = match ? match[1] : '';
      const newPath = match ? match[2] : '';

      currentFile = {
        oldPath: oldPath || '',
        newPath: newPath || oldPath || '',
        isNew: false,
        isDeleted: false,
        isRenamed: false,
        isBinary: false,
        hunks: [],
        additions: 0,
        deletions: 0,
        rawDiff: line + '\n',
      };
      continue;
    }

    if (!currentFile) {
      continue;
    }

    currentFile.rawDiff += line + '\n';

    if (line.startsWith('new file mode ')) {
      currentFile.isNew = true;
      continue;
    }

    if (line.startsWith('deleted file mode ')) {
      currentFile.isDeleted = true;
      continue;
    }

    if (line.startsWith('similarity index ') || line.startsWith('rename from ') || line.startsWith('rename to ')) {
      currentFile.isRenamed = true;
      if (line.startsWith('rename from ')) {
        currentFile.oldPath = line.substring('rename from '.length).trim();
      }
      if (line.startsWith('rename to ')) {
        currentFile.newPath = line.substring('rename to '.length).trim();
      }
      continue;
    }

    if (line.includes('Binary files ') && line.includes('differ')) {
      currentFile.isBinary = true;
      continue;
    }

    // Check for hunk header: @@ -1,5 +1,6 @@ optional header
    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
    if (hunkMatch) {
      if (currentHunk) {
        currentFile.hunks.push(currentHunk);
      }

      const oldStart = parseInt(hunkMatch[1], 10);
      const oldLines = hunkMatch[2] !== undefined ? parseInt(hunkMatch[2], 10) : 1;
      const newStart = parseInt(hunkMatch[3], 10);
      const newLines = hunkMatch[4] !== undefined ? parseInt(hunkMatch[4], 10) : 1;

      curOldLine = oldStart;
      curNewLine = newStart;

      currentHunk = {
        header: line,
        oldStart,
        oldLines,
        newStart,
        newLines,
        lines: [],
      };
      continue;
    }

    if (!currentHunk) {
      continue;
    }

    if (line.startsWith('+')) {
      currentHunk.lines.push({
        type: 'addition',
        content: line.slice(1),
        newLineNumber: curNewLine++,
      });
      currentFile.additions++;
    } else if (line.startsWith('-')) {
      currentHunk.lines.push({
        type: 'deletion',
        content: line.slice(1),
        oldLineNumber: curOldLine++,
      });
      currentFile.deletions++;
    } else if (line.startsWith(' ')) {
      currentHunk.lines.push({
        type: 'context',
        content: line.slice(1),
        oldLineNumber: curOldLine++,
        newLineNumber: curNewLine++,
      });
    } else if (line.startsWith('\\ No newline at end of file')) {
      // Diff metadata line, omit line counter
    }
  }

  if (currentHunk && currentFile) {
    currentFile.hunks.push(currentHunk);
  }
  if (currentFile) {
    files.push(currentFile);
  }

  return files;
}
