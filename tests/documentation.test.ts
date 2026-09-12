import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 护栏：公开文档不得携带私有 scope 前缀、本地域名，或与具体业务相关的
 * 字段名示例。这里只做通用结构校验，不列举具体禁用词——那些词本身会泄露
 * 项目关联，因此不写入仓库。
 */
const forbiddenPatterns = [
  // 公开包是 unscoped，不得带 @scope/ 前缀
  /@[a-z][a-z0-9-]*\//i,
  // 本地绝对路径残留
  /\/Users\/[^/]+\//i,
  // 业务字段示例（统一用 topic/data 等通用名）
  /renderPrice|orderStore/i
];

function listDocumentationFiles(path: string): string[] {
  return readdirSync(path).flatMap(name => {
    const child = join(path, name);
    // docs/progress.md is an internal, non-shipped tracking artifact (excluded
    // from the package files); the public-docs guard does not apply to it.
    if (name === 'progress.md') return [];
    return statSync(child).isDirectory() ? listDocumentationFiles(child) : [child];
  });
}

describe('public documentation', () => {
  it('does not contain private scopes, local domains, or business-specific fields', () => {
    const files = [
      'README.md',
      'CHANGELOG.md',
      ...listDocumentationFiles('docs'),
      ...listDocumentationFiles('examples')
    ];
    const content = files.map(file => `${file}\n${readFileSync(file, 'utf8')}`).join('\n');

    for (const pattern of forbiddenPatterns) expect(content).not.toMatch(pattern);
  });

  it('keeps relative documentation links valid', () => {
    const files = ['README.md', 'CHANGELOG.md', ...listDocumentationFiles('docs')];

    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      const links = [...content.matchAll(/\[[^\]]+\]\((\.\.?\/[^)#]+)(?:#[^)]+)?\)/g)];
      for (const match of links) {
        const link = match[1];
        expect(link, `${file} contains an invalid relative link`).toBeDefined();
        expect(existsSync(resolve(dirname(file), link!)), `${file} -> ${link}`).toBe(true);
      }
    }
  });

  it('keeps the CHANGELOG section for the current package version', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    const changelog = readFileSync('CHANGELOG.md', 'utf8');
    // The Release workflow extracts release notes by matching `## [<version>]`.
    // A missing section makes a tagged release fail before npm is reached, so
    // this guard prevents version bumps that forget the changelog entry.
    expect(
      changelog,
      `CHANGELOG.md must contain a "## [${pkg.version}]" section so the Release workflow can build release notes`
    ).toContain(`## [${pkg.version}]`);
  });

  it('documents the blocking published-consumer verification in the release checklist', () => {
    for (const file of ['docs/release-checklist.md', 'docs/zh/release-checklist.md']) {
      const content = readFileSync(file, 'utf8');
      expect(content, `${file} must mention the consumer verifier`).toContain('verify:published');
      expect(content, `${file} must describe the check as blocking`).toMatch(/blocking|阻塞/);
    }
  });

  it('keeps both release checklists aligned with the CI gate set', () => {
    // The Before-tagging steps must mirror what CI enforces, in both
    // languages, or a local dry run silently skips a blocking gate.
    for (const file of ['docs/release-checklist.md', 'docs/zh/release-checklist.md']) {
      const content = readFileSync(file, 'utf8');
      for (const gate of ['test:coverage', 'verify:compat', 'verify:pack', 'bench:compare', 'fetch --tags']) {
        expect(content, `${file} must document the ${gate} gate`).toContain(gate);
      }
    }
  });

  it('keeps every markdown table rectangular', () => {
    // A cell containing an unescaped pipe silently splits the row and shifts
    // every following column, so the table renders wrong (a real defect found
    // in the capabilities matrix: a description landed one row down, leaving
    // a 3-cell row beside a 5-cell row). Split on unescaped pipes only — `\|`
    // is a literal pipe inside a cell and must not count as a separator.
    const countCells = (line: string): number => {
      const parts = line.split(/(?<!\\)\|/);
      if (parts[0]?.trim() === '') parts.shift();
      if (parts[parts.length - 1]?.trim() === '') parts.pop();
      return parts.length;
    };
    const files = ['README.md', 'README.zh.md', 'CHANGELOG.md', ...listDocumentationFiles('docs')];

    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n');
      let block: Array<{ line: number; text: string }> = [];
      const check = () => {
        if (block.length < 2) return;
        const widths = new Set(block.map(entry => countCells(entry.text)));
        expect(
          widths.size,
          `${file}:${block[0]!.line} table mixes cell counts ${[...widths].sort().join('/')} — an unescaped pipe is splitting a row`
        ).toBe(1);
      };
      lines.forEach((text, index) => {
        if (text.startsWith('|')) {
          block.push({ line: index + 1, text });
        } else {
          check();
          block = [];
        }
      });
      check();
    }
  });

  it('does not repeat a subheading within one CHANGELOG version section', () => {
    // The Release workflow extracts a version section verbatim for the
    // release notes, so a duplicated `### Added` / `### Changed` block reads
    // as a malformed section. (Found in [Unreleased]: two `### Changed`
    // headings had accumulated across sessions.)
    const lines = readFileSync('CHANGELOG.md', 'utf8').split('\n');
    let section = '(preamble)';
    const seen = new Map<string, Set<string>>();
    for (const line of lines) {
      const sectionMatch = /^## \[?([^\]]+)\]?/.exec(line);
      if (sectionMatch) {
        section = sectionMatch[1]!.trim();
        continue;
      }
      const heading = /^### (.+)$/.exec(line);
      if (heading) {
        const headings = seen.get(section) ?? new Set<string>();
        expect(
          headings.has(heading[1]!),
          `CHANGELOG.md section "${section}" repeats the "${heading[1]}" subheading`
        ).toBe(false);
        headings.add(heading[1]!);
        seen.set(section, headings);
      }
    }
  });

  it('marks every CHANGELOG version heading as an h2', () => {
    // The Release workflow finds a release's notes by matching `## [<version>]`.
    // A version heading at the wrong level (a single `#`) is invisible to that
    // match, so the release would publish without notes. (Found: 0.20.60 was
    // an h1, which also made its `### Added` block look like a duplicate of
    // the previous version's.)
    const lines = readFileSync('CHANGELOG.md', 'utf8').split('\n');
    for (const [index, line] of lines.entries()) {
      const heading = /^(#{1,6}) \[?\d+\.\d+\.\d+\]?/.exec(line);
      if (!heading) continue;
      expect(
        heading[1],
        `CHANGELOG.md:${index + 1} version heading must use "## " so the Release workflow can match it`
      ).toBe('##');
    }
  });
});
