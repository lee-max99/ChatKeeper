import { readFile, readdir, writeFile } from 'node:fs/promises';
const names = ['dompurify', 'turndown', 'katex', 'commander', 'markdown-it', 'argparse', 'entities', 'linkify-it', 'mdurl', 'punycode.js', 'uc.micro'];
const sections = ['ChatKeeper third-party notices'];
for (const name of names) {
  const root = new URL(`../node_modules/${name}/`, import.meta.url);
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  const licenses = (await readdir(root)).filter(file => /^(license|copying|notice)([.-]|$)/i.test(file));
  if (!licenses.length) throw new Error(`Missing license for ${name}`);
  sections.push(`${name} ${pkg.version}\n${await Promise.all(licenses.map(file => readFile(new URL(file, root), 'utf8'))).then(items => items.join('\n\n'))}`);
}
await writeFile(new URL('../public/THIRD_PARTY_NOTICES.txt', import.meta.url), sections.join('\n\n'), 'utf8');
