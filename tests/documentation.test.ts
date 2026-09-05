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
});
