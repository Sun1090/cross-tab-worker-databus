import { readFileSync } from 'node:fs';

const tag = process.env.RELEASE_TAG;
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
if (!tag || tag !== `v${version}`) {
  throw new Error(`release tag ${JSON.stringify(tag)} must equal package version tag v${version}`);
}

const changelog = readFileSync('CHANGELOG.md', 'utf8');
const headings = [...changelog.matchAll(/^## \[([^\]]+)\](.*)$/gm)];
const matching = headings.filter(heading => heading[1] === version);
if (matching.length !== 1) {
  throw new Error(`CHANGELOG must contain exactly one section for ${version}`);
}
const heading = matching[0];
const next = headings.find(candidate => candidate.index > heading.index);
const notes = changelog.slice(heading.index + heading[0].length, next?.index).trim();
if (!notes) {
  throw new Error(`CHANGELOG section for ${version} must contain release notes`);
}
console.log(`[release] ${tag} matches package.json and has non-empty release notes`);
