import { execFileSync } from 'node:child_process';
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

/**
 * Every path in the repository's own index. A prose gate's scope is expressed
 * against this set rather than against the directory on disk, because a walk
 * silently includes generated, gitignored output — and whether that output
 * exists depends on whether a build has run on this machine.
 */
function trackedFiles(): Set<string> {
  return new Set(execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean));
}

/** Keep only the tracked members of a walked list. */
function keepTracked(files: string[], tracked: Set<string>): string[] {
  return files.filter(file => tracked.has(file));
}

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
  it('scans tracked files only, so a build artifact cannot join or leave the scope', () => {
    // The predicate the privacy gate is scoped by, pinned on *fabricated* input
    // rather than on the working tree — which is the only way this case means the
    // same thing on a clean checkout and on one that has run `pnpm examples`.
    // `examples/react/vendor/react.esm.js` is gitignored output of
    // `scripts/build-example-vendor.mjs`, so it is absent in CI's `verify` job
    // (`pnpm check` never builds examples) and present at home, and it must not
    // change what a docs gate reads.
    const tracked = trackedFiles();
    expect(keepTracked(['README.md', 'examples/react/vendor/react.esm.js'], tracked)).toEqual([
      'README.md'
    ]);
    // The other direction, because a filter that drops everything passes the
    // assertion above: a tracked example source must survive it.
    expect(keepTracked(['examples/demo/demo.js'], tracked)).toEqual(['examples/demo/demo.js']);
    // And the exclusion is about *this* path, not about the walk being empty:
    // `examples/` has tracked sources to keep. Take the count from the index
    // (`git ls-files examples | wc -l`) rather than from this comment.
    expect([...tracked].filter(f => f.startsWith('examples/')).length).toBeGreaterThan(0);
  });

  it('does not contain private scopes, local domains, or business-specific fields', () => {
    // Scope is the repository's own files. `listDocumentationFiles` walks a
    // directory as it is on disk, and `examples/` holds generated output:
    // `pnpm build:examples` writes `examples/react/vendor/react.esm.js` (1.13 MB)
    // plus a 1.75 MB map, so an unfiltered walk runs these regexes over a
    // third-party bundle — on *some* machines only. CI's `verify` job never builds
    // it and the `browser` job that does runs no vitest, so a vendored `@scope/`
    // import specifier, or an absolute path in a future map, would redden a
    // docs-only PR at home and pass the gate that decides merge. Neither artifact
    // matches any pattern today (measured: 0 hits for all three, in both files), so
    // this is scope stability rather than a live leak; the pin is the case above.
    const files = keepTracked(
      [
        'README.md',
        'CHANGELOG.md',
        ...listDocumentationFiles('docs'),
        ...listDocumentationFiles('examples')
      ],
      trackedFiles()
    );
    // Control on the scan itself: an over-eager filter that kept only the two root
    // files would pass every pattern with the example sources unread.
    expect(
      files.filter(f => f.startsWith('examples/')).length,
      'the privacy gate must still read the tracked example sources'
    ).toBeGreaterThan(0);
    const content = files.map(file => `${file}\n${readFileSync(file, 'utf8')}`).join('\n');

    for (const pattern of forbiddenPatterns) expect(content).not.toMatch(pattern);
  });

  it('keeps relative documentation links valid', () => {
    const files = ['README.md', 'README.zh.md', 'CONTRIBUTING.md', 'CHANGELOG.md', ...listDocumentationFiles('docs')];

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

  it('documents local fan-out without claiming end-to-end exactly-once delivery', () => {
    const expectations = [
      {
        file: 'docs/architecture.md',
        localGuarantee: 'at-most-once fan-out per accepted transport publication',
        endToEndBoundary: 'does not provide end-to-end at-least-once or exactly-once delivery'
      },
      {
        file: 'docs/zh/architecture.md',
        localGuarantee: '每次已接受的 transport publication 至多扇出一次',
        endToEndBoundary: '不提供端到端的 at-least-once 或 exactly-once 保证'
      }
    ];

    for (const { file, localGuarantee, endToEndBoundary } of expectations) {
      const content = readFileSync(file, 'utf8');
      expect(content, `${file} must state the bounded local fan-out guarantee`).toContain(localGuarantee);
      expect(content, `${file} must state the end-to-end delivery boundary`).toContain(endToEndBoundary);
      expect(content, `${file} must not claim exactly-once dispatch per subscriber`).not.toMatch(
        /exactly-once dispatch per subscriber|保证\*\*每个 subscriber 恰好分发一次\*\*/
      );
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

  it('documents every replay/dedup option field in both configuration references', () => {
    // The interface is the public contract, but nothing tied its fields to the
    // docs — `pruneStrategy` was shipped with no reference entry at all. Read
    // the field list from the built declaration so a new option fails the suite
    // until it is documented in both languages.
    const interfaces: Array<{ file: string; name: string }> = [
      { file: join('dist', 'core', 'data-bus.d.ts'), name: 'DataBusReplayOptions' },
      { file: join('dist', 'core', 'dedup-manager.d.ts'), name: 'DataBusDedupOptions' }
    ];

    for (const { file, name } of interfaces) {
      const declaration = readFileSync(file, 'utf8');
      const start = declaration.indexOf(`interface ${name}`);
      expect(start, `${name} must be present in the built declarations`).toBeGreaterThan(-1);
      const body = declaration.slice(start, declaration.indexOf('\n}', start));
      // Top-level members are indented four spaces in the emitted declaration;
      // deeper matches are nested inline object fields.
      const fields = [...body.matchAll(/^ {4}(\w+)\??:/gm)].map(match => match[1]!);
      expect(fields.length).toBeGreaterThan(0);

      for (const doc of ['docs/configuration.md', 'docs/zh/configuration.md']) {
        const content = readFileSync(doc, 'utf8');
        const missing = fields.filter(field => !content.includes(`\`${field}\``));
        expect(missing, `${doc} must document every ${name} field`).toEqual([]);
      }
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

  it('keeps each progress-log phase entry numbered once, in order, and above the standing sections', () => {
    // Phase entries are appended at a shared anchor, so two branches that each
    // add a `## Phase N / …` block collide into two blocks with one number —
    // and the merge can leave one of them *below* the `## Next candidates`
    // heading the phase log is supposed to sit above. Both happened at once:
    // closed PR #233 left a second `## Phase 142` after that heading, next to
    // merged PR #234's copy, and nothing read wrong until
    // `grep -c "^## Phase 142"` returned 2. The legacy convention in the first
    // 83 phases writes `## Phase N (in progress …)` plus a `## Phase N result …`
    // line, which legitimately repeats a number, so this gate covers the
    // current `## Phase N / Title` form only.
    const lines = readFileSync(join('docs', 'progress.md'), 'utf8').split('\n');
    const standing = lines.findIndex(line => /^## Next candidates\b/.test(line));
    expect(standing, 'docs/progress.md must keep its "## Next candidates" section').toBeGreaterThan(-1);
    let previousPhase = 0;
    let previousLine = 0;
    for (const [index, line] of lines.entries()) {
      const heading = /^## Phase (\d+) \//.exec(line);
      if (!heading) continue;
      const phase = Number(heading[1]);
      expect(
        phase > previousPhase,
        `docs/progress.md:${index + 1} "${line}" repeats or reorders a phase number; the previous entry is at :${previousLine} (Phase ${previousPhase})`
      ).toBe(true);
      expect(
        index < standing,
        `docs/progress.md:${index + 1} sits below the "## Next candidates" heading at :${standing + 1}; phase entries belong above it, in the log`
      ).toBe(true);
      previousPhase = phase;
      previousLine = index + 1;
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

  // The localized docs are maintained side by side with the English originals,
  // so they drift silently when a section, table row, or config entry is only
  // added to one language. These guards compare the structural skeleton of each
  // pair; they do not compare prose (translations legitimately differ).
  const localizedDocNames = readdirSync('docs').filter(
    name => name.endsWith('.md') && name !== 'progress.md'
  );

  const countMatches = (text: string, pattern: RegExp): number => (text.match(pattern) ?? []).length;

  it('keeps every localized doc pair at the same h2 section count', () => {
    // A section present in only one language is invisible to readers of the
    // other. (Found: docs/release-checklist.md lacked the "Security and
    // dependency scanning" section that only the Chinese copy carried.)
    for (const name of localizedDocNames) {
      const en = readFileSync(join('docs', name), 'utf8');
      const zh = readFileSync(join('docs/zh', name), 'utf8');
      expect(
        countMatches(zh, /^## /gm),
        `docs/zh/${name} has a different number of "## " sections than docs/${name}`
      ).toBe(countMatches(en, /^## /gm));
    }
  });

  it('keeps every localized doc pair at the same markdown table row count', () => {
    // Table rows are 1:1 across languages (only the cell text is translated),
    // so a missing row means a documented option silently vanished from one
    // language. (Found: docs/zh/configuration.md was missing the
    // `recovery.cooldownMs` and `recovery.maxAttempts` rows.)
    for (const name of localizedDocNames) {
      const en = readFileSync(join('docs', name), 'utf8');
      const zh = readFileSync(join('docs/zh', name), 'utf8');
      expect(
        countMatches(zh, /^\|/gm),
        `docs/zh/${name} has a different number of table rows than docs/${name}`
      ).toBe(countMatches(en, /^\|/gm));
    }
  });

  it('enumerates every shipped doc explicitly in package.json files', () => {
    // package.json lists the docs one by one (so the internal progress.md stays
    // out of the tarball). npm only auto-includes files named README* / LICENSE*
    // / CHANGELOG* plus package.json — a *non*-README doc that is added to disk
    // but forgotten here would silently vanish from the published package. This
    // asserts the enumeration is complete, and keeps the English/Chinese pairs
    // symmetric (docs/README.md and README.md are both listed explicitly, so
    // their localized twins must be too).
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { files: string[] };
    const listed = new Set(pkg.files);
    const missing: string[] = [];
    for (const dir of ['docs', 'docs/zh']) {
      for (const name of readdirSync(dir)) {
        if (!name.endsWith('.md') || name === 'progress.md') continue;
        const relative = `${dir}/${name}`;
        if (!listed.has(relative)) missing.push(relative);
      }
    }
    for (const name of ['README.md', 'README.zh.md', 'CHANGELOG.md', 'LICENSE']) {
      if (!listed.has(name)) missing.push(name);
    }
    expect(missing, 'every shipped doc must be enumerated in package.json files').toEqual([]);
    expect(pkg.files, 'the internal progress.md must not be published').not.toContain('docs/progress.md');
  });

  it('documents every public root export in both API references', async () => {
    // The API reference is the consumer-facing contract, but nothing tied it to
    // the code, so four of the nineteen root exports (DEFAULT_MAX_ACTIVE_WORKERS,
    // approximatePayloadBytes, effectiveWorkerLoad, getOrCreateTabId) and the
    // CrossTabDataBus.publishBatch method were simply absent from it. Deriving
    // the list from the built entry point makes a new export fail the suite
    // until it is documented, instead of shipping an undocumented public symbol.
    const distIndex = resolve('dist/index.js');
    expect(existsSync(distIndex), 'run the build before the documentation guard (pnpm check does)').toBe(true);
    // Built as a non-literal specifier so `tsc --noEmit` does not statically
    // resolve it: `pnpm check` runs typecheck BEFORE build, so on a fresh
    // checkout dist/ does not exist yet and a literal specifier fails with
    // TS2307. (Same pattern as tests/dual-format.test.ts.)
    const lib = (await import(/* @vite-ignore */ `../dist/${'index.js'}`)) as Record<string, unknown>;
    const names = Object.keys(lib).sort();
    expect(names.length, 'the root entry point must export a public surface').toBeGreaterThan(0);

    for (const file of ['docs/api.md', 'docs/zh/api.md']) {
      const content = readFileSync(file, 'utf8');
      const missing = names.filter(name => !content.includes(name));
      expect(missing, `${file} must document every public root export`).toEqual([]);
    }
  });

  it('documents every adapter export inside that adapter entry own section', () => {
    // `/hooks` and `/vue` export the *same* four composable names, so a name
    // appearing somewhere in the reference proves nothing about the section a
    // reader is in. The health composable was documented under the React
    // section in English and under the Vue section in Chinese — each language
    // left the other adapter with no entry for it at all, and the Chinese Vue
    // heading used the React name while its body described a Vue `Ref`.
    // Splitting on h2 and requiring each entry's own section to carry every
    // export of that entry catches this; the h2/row/list parity guards cannot,
    // because both languages have the same shape.
    const entryExports = (declaration: string): string[] =>
      [...readFileSync(declaration, 'utf8').matchAll(/^export (?:declare )?(?:function|const|class) (\w+)/gm)]
        .map(match => match[1]!)
        .sort();

    const h2Sections = (text: string): Array<{ title: string; body: string }> => {
      const sections: Array<{ title: string; body: string }> = [];
      for (const line of text.split('\n')) {
        if (line.startsWith('## ')) sections.push({ title: line, body: '' });
        else if (sections.length > 0) sections[sections.length - 1]!.body += `${line}\n`;
      }
      return sections;
    };

    for (const file of ['docs/api.md', 'docs/zh/api.md']) {
      const sections = h2Sections(readFileSync(file, 'utf8'));
      for (const [marker, declaration] of [
        ['/hooks', 'dist/hooks.d.ts'],
        ['/vue', 'dist/vue.d.ts']
      ] as const) {
        const names = entryExports(declaration);
        expect(names.length, `${declaration} must export at least one composable`).toBeGreaterThan(0);
        const section = sections.find(entry => entry.title.includes(marker));
        expect(section, `${file} must have an h2 section for the ${marker} entry`).toBeDefined();
        const missing = names.filter(name => !section!.body.includes(name));
        expect(
          missing,
          `${file}: the ${marker} section must document every export of that entry`
        ).toEqual([]);
      }
    }
  });

  it('keeps every localized doc pair at the same list-item count', () => {
    // Bullet and ordered-list items are 1:1 across languages, so a dropped item
    // is a silently lost guarantee/step in one language. (Would have caught the
    // Chinese roadmap losing the 0.11.0 section and the 0.13.0 candidate list.)
    for (const name of localizedDocNames) {
      const en = readFileSync(join('docs', name), 'utf8');
      const zh = readFileSync(join('docs/zh', name), 'utf8');
      expect(
        countMatches(zh, /^([-*] |\d+\. )/gm),
        `docs/zh/${name} has a different number of list items than docs/${name}`
      ).toBe(countMatches(en, /^([-*] |\d+\. )/gm));
    }
  });

  it('keeps every release-scope block in the roadmap titled, ordered and mirrored', () => {
    // Three structural properties of docs/roadmap.md's release ledger, each
    // written against something measured on this tree rather than imagined:
    // - *Title.* The suffix is part of the convention, not decoration. One zh
    //   block was titled `## 0.20.68 已交付` while the other 141 said
    //   `已完成范围`, and a heading-set diff keyed on that suffix reported the
    //   block as absent from the Chinese mirror — a paraphrase read as an
    //   absence, and the false finding outlived the measurement that produced
    //   it. So the allowed set is enumerated here, and anything else is red.
    // - *Order.* The blocks run newest-first. Exactly one of the 144 was
    //   elsewhere (0.20.68, left where an appended block had landed: after
    //   0.11.0), and nothing but a scan could see that a ledger of 144 entries
    //   had one insertion in the wrong place.
    // - *Mirror.* Both languages must list the same set of releases. This leg is
    //   prospective — measured clean across all ten localized pairs today — and
    //   it is the one the count-equality gates above cannot do: equal h2 counts
    //   passed while one pair disagreed on which releases it named.
    const ledger = (file: string, allowed: readonly string[]) => {
      const offenders: string[] = [];
      const versions: Array<[number, number, number]> = [];
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        const match = /^## (\d+)\.(\d+)\.(\d+) (.+)$/.exec(line);
        if (!match) continue;
        const [, major, minor, patch, suffix] = match;
        const kind = suffix!.replace(/[:：]?\s*$/, '');
        // `## 0.20.69 candidates` / `## 0.13.0 候选` name a *future* list, and
        // one version can legitimately head both a scope block and a candidate
        // list; only the scope blocks join the ledger.
        if (kind === 'candidates' || kind === '候选') continue;
        if (!allowed.includes(kind)) {
          offenders.push(`${file}: "${line}" is not one of ${allowed.join(' / ')}`);
          continue;
        }
        versions.push([Number(major), Number(minor), Number(patch)]);
      }
      expect(offenders, 'every roadmap release heading uses a title from that file\'s convention').toEqual([]);
      return versions;
    };

    const en = ledger('docs/roadmap.md', ['delivered scope', 'frozen scope']);
    const zh = ledger('docs/zh/roadmap.md', ['已完成范围', '冻结范围']);
    const asText = (v: [number, number, number]) => v.join('.');

    for (const [file, list] of [['docs/roadmap.md', en], ['docs/zh/roadmap.md', zh]] as const) {
      const misplaced: string[] = [];
      for (let i = 1; i < list.length; i += 1) {
        const before = list[i - 1]!;
        const current = list[i]!;
        const newerFirst =
          before[0] - current[0] || before[1] - current[1] || before[2] - current[2];
        if (newerFirst <= 0) {
          misplaced.push(
            `${file}: ${asText(current)} is not older than ${asText(before)} — the ledger runs newest-first`
          );
        }
      }
      expect(misplaced).toEqual([]);
    }

    const sorted = (list: Array<[number, number, number]>) =>
      [...list].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]).map(asText);
    const enVersions = new Set(sorted(en));
    const zhVersions = new Set(sorted(zh));
    expect(
      [...enVersions].filter(v => !zhVersions.has(v)).concat([...zhVersions].filter(v => !enVersions.has(v))),
      'both roadmap languages must carry a release-scope block for the same versions'
    ).toEqual([]);
  });

  it('leaves no empty section in the shipped documentation', () => {
    // A heading immediately followed by another heading of the same or higher
    // level renders as an empty section. (Found: docs/zh/roadmap.md's
    // "0.13.0 候选" section had lost its four items.)
    const files = ['README.md', 'README.zh.md', 'CONTRIBUTING.md', ...listDocumentationFiles('docs')];
    const emptySections: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        const heading = /^(#{2,3}) /.exec(line);
        if (!heading) return;
        let next = index + 1;
        while (next < lines.length && lines[next]!.trim() === '') next += 1;
        if (next >= lines.length) return;
        const following = /^(#{1,6}) /.exec(lines[next]!);
        if (following && following[1]!.length <= heading[1]!.length) {
          emptySections.push(`${file}:${index + 1} "${line}" is immediately followed by "${lines[next]}"`);
        }
      });
    }
    expect(emptySections).toEqual([]);
  });
});

/** Every `.ts`/`.tsx` under `dir`, recursing into subdirectories. */
function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const child = join(dir, name);
    if (statSync(child).isDirectory()) return listSourceFiles(child);
    return /\.tsx?$/.test(name) ? [child] : [];
  });
}

describe('test-name citations', () => {
  it('resolve to a case that exists in the file they name', () => {
    // A comment that cites a case by name is a claim that the name exists, and
    // like a line number it decays silently: nothing in the build, the type
    // check or the suite contradicts it when the case is renamed. Found twice in
    // one pass — `src/core/routing.ts` cited `sticky-existing-routes` and
    // `src/core/trace.ts` cited `no-trace`, and neither is an `it()` title. Both
    // are `clusterKey` literals sitting *inside* the test body, so the citation
    // sends a reader to the middle of a case, and the first fixture rename to
    // those arbitrary strings would have sent them nowhere at all.
    //
    // Scope is every living prose surface: `src/**`, `AGENTS.md`, both root READMEs,
    // `CONTRIBUTING.md` and the public docs. `listDocumentationFiles` already exempts `docs/progress.md`
    // from the shipped-docs guard, and the same exemption applies here for the
    // same kind of reason — a phase entry dates what a sweep found, so its
    // citations are records rather than instructions. That exemption is what makes the
    // scope affordable. Take any tally from the scope array plus the two regexes below in
    // a scratch script, never from this comment: the scanned scope holds few citations and
    // the assertion right here proves each resolves, while the exempt pair holds more and
    // grows with every phase entry — so a count quoted for it is stale by the next commit,
    // which is exactly the decay this gate exists to catch. What the hand re-run over
    // `docs/progress.md` and `CHANGELOG.md` establishes is the *kind* of each non-resolver,
    // and every one found so far is a report rather than a pointer: an entry quoting this
    // gate's own failure message verbatim. (A second one appeared on this tree and was not
    // a report — it was an exemplum written in citation form, naming a fixture's method the
    // way a citation names a case title. That class is the one `AGENTS.md` forbids, so the
    // entry was rewritten into bare form rather than exempted.) A gate that scanned
    // `progress.md` would spend its first run on history, so the pass stays manual and its
    // recipe is recorded in `AGENTS.md`.
    //
    // The possessive form is the only shape scanned, and that is measured rather
    // than timid. The next loosest one — the file named, then `('a name')` within
    // a window — yields exactly one candidate across this whole scope, and it is
    // not a citation: it is the `new Error("…")` message in the `catch` of the
    // very function whose doc comment names `tests/dual-format.test.ts`, joined
    // because a proximity window cannot tell "the test this note cites" from "a
    // quoted string that happens to sit below it". A form that needs a heuristic
    // to separate from prose is a form whose first output is its own parser.
    //
    // What this gate does *not* yet exercise: the `e2e` half of the citation
    // pattern. No possessive citation in the scanned scope names an
    // `e2e/*.spec.ts` — the spec files are mentioned only in `progress.md`, which
    // is exempt, and even there never in the possessive form — so whoever first
    // cites a Playwright case from a scanned file pins that alternation.
    const titlesByFile = new Map<string, Set<string>>();
    for (const file of [...listSourceFiles('tests'), ...listSourceFiles('e2e')]) {
      if (!/\.(test|spec)\.tsx?$/.test(file)) continue;
      const content = readFileSync(file, 'utf8');
      const titles = new Set<string>();
      for (const match of content.matchAll(
        /\b(?:it|test)(?:\.\w+)*\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g
      )) {
        titles.add(match[2]!);
      }
      titlesByFile.set(file.split('/').pop()!, titles);
    }
    // Guard the scan itself: a title collector that matches nothing would report
    // every citation dead, and one that matches too much would accept anything.
    // The floor is deliberately not the corpus size. That number moves every time a
    // case is added anywhere in `tests/` — this file's own new case moves it — so a
    // floor at it would redden an unrelated PR, and a floor at half of it is still
    // out of reach of a collector that stopped working. Re-derive it by printing the
    // reduced total here rather than trusting any figure quoted in this comment,
    // including the two that were here until they were replaced by this sentence.
    expect(
      [...titlesByFile.values()].reduce((total, set) => total + set.size, 0),
      'the citation scan must find the suite case titles'
    ).toBeGreaterThan(500);
    // And the e2e corpus separately, because the total above cannot notice it going
    // empty: almost every title comes from `tests/`, so dropping the e2e sweep
    // entirely still clears a 500 floor. Sum the two key sets separately to see the
    // skew; do not quote it.
    expect(
      [...titlesByFile.keys()].filter(name => name.endsWith('.spec.ts')).length,
      'the citation scan must collect titles from the e2e specs as well as tests/'
    ).toBeGreaterThan(0);

    const citation = /(?:tests|e2e)\/([A-Za-z0-9_.-]+\.(?:test\.)?tsx?)`?['’]s\s*([`'“"])((?:\\.|(?!\2)[^\\]){6,300}?)\2/g;
    const unresolved: string[] = [];
    let examined = 0;
    for (const file of [
      'AGENTS.md',
      'README.md',
      'README.zh.md',
      'CONTRIBUTING.md',
      ...listDocumentationFiles('docs').filter(name => name.endsWith('.md')),
      ...listSourceFiles('src')
    ]) {
      for (const match of readFileSync(file, 'utf8').matchAll(citation)) {
        examined += 1;
        const namedFile = match[1]!;
        const rawName = match[3]!;
        // Comments wrap, and the continuation marker is part of the source line
        // rather than of the cited name.
        const name = rawName
          .replace(/\n\s*(?:\/\/+\s*|\*\s*)/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        const titles = titlesByFile.get(namedFile);
        if (!titles) {
          unresolved.push(`${file} cites tests/${namedFile}, which has no cases here`);
          continue;
        }
        // A trailing ellipsis is how a citation marks truncation, so prefix-match
        // it — but only against one case, or the name decides nothing.
        const hits = name.endsWith('…')
          ? [...titles].filter(title => title.startsWith(name.slice(0, -1)))
          : [...titles].filter(title => title === name);
        if (hits.length !== 1) {
          unresolved.push(`${file} cites tests/${namedFile}'s "${name}" (${hits.length} matches)`);
        }
      }
    }
    expect(unresolved).toEqual([]);
    // The other way this gate can go wrong is by looking at nothing: an empty
    // `unresolved` is also what a citation pattern that matches no file produces,
    // and that reads as a clean bill. Re-derive `examined` with a `console.log` here,
    // and the scope's size from the array above — the same rule this test exists to
    // enforce on other people's prose. `README.zh.md` was added to the list because the
    // scope sentence claims every living prose surface, and it carries zero citations
    // today, so that addition changes nothing a reader can see; it is the *next* one
    // that would otherwise slip past a gate whose comment says it was scanned.
    expect(examined, 'the citation scan must examine at least one citation').toBeGreaterThan(0);
  });
});

describe('AGENTS.md directory layout', () => {
  it('names every tracked file under src, tests and e2e', () => {
    // This section is the map a fresh session reads first, so an entry it does not
    // contain is a file that session will not know exists — and a file it names that
    // has since moved is a path it walks to and does not find. Both halves are cheap
    // to check and neither contradicts itself at build time. The block named 18 of the
    // 46 `.ts`/`.tsx` files under `tests/` and `e2e/` when this gate was written, so
    // the drift is not hypothetical; it is also why `docs/` is out of scope, since
    // that half of the block is a deliberate summary rather than an index.
    const agents = readFileSync('AGENTS.md', 'utf8');
    const heading = agents.indexOf('## Directory layout');
    const open = agents.indexOf('```', heading);
    const close = agents.indexOf('```', open + 3);
    expect(heading, 'AGENTS.md must keep a `## Directory layout` section').toBeGreaterThanOrEqual(0);
    expect(open, 'the layout section must stay a fenced block').toBeGreaterThan(heading);
    expect(close, 'the layout fence must be closed').toBeGreaterThan(open);
    const block = agents.slice(open + 3, close);
    // The fence extraction is the failure mode that makes this gate vacuous: slip it
    // and `block` becomes the whole file, every name "appears", and the gate passes by
    // reading prose that sits outside the map. So pin the block's own edges rather than
    // trusting the indices — it starts at the first directory and stops before the next
    // heading.
    expect(block.trimStart().startsWith('src/'), 'the extracted block must start at the layout, not earlier').toBe(true);
    expect(block.includes('## Common tasks'), 'the extracted block must not have run past the layout section').toBe(false);

    const tracked = execFileSync('git', ['ls-files', 'src', 'tests', 'e2e'], { encoding: 'utf8' })
      .split('\n')
      .filter(name => name.length > 0);
    const unnamedIn = (layout: string) =>
      tracked.filter(file => !layout.includes(file) && !layout.includes(file.split('/').pop()!));

    expect(unnamedIn(block)).toEqual([]);
    // The directory half of the same map. `src`, `tests` and `e2e` are indexed
    // file-by-file, while `docs`, `scripts` and `examples` are one-line summaries — so
    // this leg asks only that every top-level directory holding code is *named*, which
    // is the part that has no scope-dependent answer. `scripts/` and `examples/` were
    // both missing from the block when this was written, which is what the leg is for.
    const everyTracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
      .split('\n')
      .filter(name => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name) && name.includes('/'))
      .map(name => name.split('/')[0]!);
    const codeDirs = [...new Set(everyTracked)].sort();
    const unnamedDirs = (layout: string) => codeDirs.filter(dir => !layout.includes(`${dir}/`));
    expect(unnamedDirs(block), `every directory holding code must be named: ${codeDirs.join(', ')}`).toEqual([]);
    // Same control discipline as the file leg, one name at a time: a filter that could
    // not report a missing directory would make the assertion above unfalsifiable.
    expect(unnamedDirs(block.replace('scripts/', 'removed-by-control')),
      'the layout check must report a directory whose entry is missing').toEqual(['scripts']);
    // A control the gate has to pass before its green means anything: doctor the block
    // by removing one real name and require that the same filter reports exactly that
    // file. Without it, a filter that always returns `[]` — from an empty tracked list,
    // or a substring rule that matches too broadly — is indistinguishable from a clean
    // tree. It runs *after* the real assertion on purpose: measured with the control
    // first, deleting a layout entry failed at the control with `expected
    // ['e2e/topics.ts', …] to deeply equal ['tests/workflows.test.ts']`, which names the
    // regression only by accident and reads as though the control itself broke.
    expect(unnamedIn(block.replace('workflows.test.ts', 'removed-by-control')),
      'the layout check must report a file whose entry is missing').toEqual(['tests/workflows.test.ts']);
    // And the corpus must not be empty, which is the other half of the same silence.
    // Floor is deliberately below the measured 76 tracked files (`git ls-files src tests
    // e2e | wc -l`), because a floor at the size reddens when a file is deleted.
    expect(tracked.length, 'the layout gate must actually see the source tree').toBeGreaterThan(50);
  });
});
