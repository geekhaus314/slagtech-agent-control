const SPECIAL = new Set(['\\', '^', '$', '.', '|', '+', '(', ')', '[', ']', '{', '}']);

export function globToRegExp(glob) {
  let pattern = glob.replaceAll('\\', '/');
  if (pattern.startsWith('./')) pattern = pattern.slice(2);
  if (pattern.endsWith('/')) pattern += '**';

  let source = '^';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        i += 1;
        if (pattern[i + 1] === '/') {
          i += 1;
          source += '(?:.*/)?';
        } else {
          source += '.*';
        }
      } else {
        source += '[^/]*';
      }
    } else if (char === '?') {
      source += '[^/]';
    } else if (SPECIAL.has(char)) {
      source += `\\${char}`;
    } else {
      source += char;
    }
  }
  source += '$';
  return new RegExp(source);
}

export function createMatcher(patterns = []) {
  const compiled = [];
  for (const raw of patterns) {
    if (typeof raw !== 'string' || raw.length === 0) continue;
    const negated = raw.startsWith('!');
    const glob = negated ? raw.slice(1) : raw;
    compiled.push({ negated, regex: globToRegExp(glob) });
  }
  return (path) => {
    let matched = false;
    for (const entry of compiled) {
      if (entry.regex.test(path)) matched = !entry.negated;
    }
    return matched;
  };
}

export function matchesAny(path, patterns = []) {
  return createMatcher(patterns)(path);
}

export function normalizePath(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//, '');
}
