// Quick demo for exclusion globs used by Anki Helper
function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const withPlaceholders = escaped.replace(/\*\*/g, '§§');
  const single = withPlaceholders.replace(/\*/g, '[^/]*');
  return new RegExp('^' + single.replace(/§§/g, '.*') + '$');
}

const patterns = ['**/*.excalidraw.md', '3R-Templates/**', '3R-ChatGPT/**', '1P，分享库/**'];
const regexps = patterns.map(globToRegExp);
const files = [
  'doc/math.excalidraw.md',
  '3R-Templates/t.md',
  '3R-ChatGPT/a/b.md',
  '1P，分享库/x.md',
  'notes/normal.md'
];

for (const f of files) {
  const excluded = regexps.some(r => r.test(f));
  console.log(f + ':', excluded ? 'excluded' : 'processed');
}
