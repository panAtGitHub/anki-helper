// Demo for run-scope path matching used by Anki Helper
function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const withPlaceholders = escaped.replace(/\*\*/g, '§§');
  const single = withPlaceholders.replace(/\*/g, '[^/]*');
  return new RegExp('^' + single.replace(/§§/g, '.*') + '$');
}

function compile(list) {
  const toGlob = p => p.endsWith('/') ? p + '**' : p;
  return list.map(p => globToRegExp(toGlob(p)));
}

function makeChecker(settings) {
  const include = compile(settings.includePaths || []);
  const exclude = compile(settings.excludePaths || []);
  return function(path) {
    if (settings.runScope === 'include') {
      return include.some(r => r.test(path));
    }
    if (settings.runScope === 'exclude') {
      return !exclude.some(r => r.test(path));
    }
    return true;
  };
}

const settings = {
  runScope: 'exclude',
  includePaths: ['Notes/Anki/'],
  excludePaths: ['Inbox/Todo.md', 'Archive/']
};
const inScope = makeChecker(settings);
const files = [
  'Notes/Anki/card.md',
  'Inbox/Todo.md',
  'Archive/note.md',
  'random.md'
];
for (const f of files) {
  console.log(f + ':', inScope(f) ? 'processed' : 'skipped');
}
