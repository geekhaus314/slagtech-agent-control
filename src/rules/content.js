import { appFiles, forEachMatch, uiFiles } from './helpers.js';

const PLACEHOLDER_COPY = [
  { regex: /\blorem ipsum\b/gi, label: 'lorem ipsum' },
  { regex: /\bdolor sit amet\b/gi, label: 'lorem ipsum' },
  { regex: /\bconsectetur (adipiscing|elit)\b/gi, label: 'lorem ipsum' },
  { regex: /\b(insert|add|replace) (your )?(text|copy|content|headline|description|image) here\b/gi, label: 'insert-here copy' },
  { regex: /\byour (headline|tagline|text|copy|content) (here|goes here)\b/gi, label: 'your-text-here copy' },
  { regex: /\bplaceholder (text|copy|headline|description)\b/gi, label: 'placeholder copy' },
  { regex: /\b(coming soon|under construction|work in progress|launching soon)\b/gi, label: 'coming-soon copy' },
  { regex: /\bthis (page|section|feature) (is|will be) (coming soon|available soon)\b/gi, label: 'coming-soon copy' },
  { regex: /\b(feature|section|page) (coming|to come|pending)\b/gi, label: 'coming-soon copy' },
  { regex: /\b(to be|tbd|to do)\s*[:\-]/gi, label: 'unfinished copy' },
];

const TEMPLATE_BOILERPLATE = [
  { regex: /get started by editing (this page|.*page\.(tsx|jsx|ts|js))/gi, label: 'Next.js starter copy' },
  { regex: /welcome to next\.?js/gi, label: 'Next.js starter copy' },
  { regex: /save and see your changes instantly/gi, label: 'Next.js starter copy' },
  { regex: /read our docs|deploy now|next\.js logo/gi, label: 'Next.js starter copy' },
  { regex: /click on the vite and react logos/gi, label: 'Vite starter copy' },
  { regex: /vite\s*\+\s*react/gi, label: 'Vite starter copy' },
  { regex: /edit src\/app\.(js|tsx|jsx) and save to reload/gi, label: 'Create React App starter copy' },
  { regex: /learn react/gi, label: 'Create React App starter copy' },
  { regex: /congratulations[\s\S]{0,80}(scaffold|generated)/gi, label: 'generated starter copy' },
  { regex: /powered by (vite|next\.js|astro|nuxt|sveltekit)/gi, label: 'starter framework banner' },
];

const PLACEHOLDER_IDENTITY = [
  { regex: /\bjohn doe\b/gi, label: 'John Doe' },
  { regex: /\bjane doe\b/gi, label: 'Jane Doe' },
  { regex: /\bjohn smith\b/gi, label: 'John Smith' },
  { regex: /\bacme (inc|corp|co|company)\b/gi, label: 'Acme' },
  { regex: /\b(your|my) (company|business|brand|product) (name|here)\b/gi, label: 'unreplaced brand' },
  { regex: /\bcompany name\b/gi, label: 'unreplaced brand' },
  { regex: /\b(user|jane|john)@example\.com\b/gi, label: 'example email' },
  { regex: /\b123 main st(reet)?\b/gi, label: 'example address' },
  { regex: /\(?555\)?[ .-]?0100/gi, label: 'example phone number' },
];

const PLACEHOLDER_MEDIA = [
  { regex: /(via\.placeholder\.com|placehold\.co|placeholder\.com|dummyimage\.com|loremflickr\.com|placekitten\.com|fakeimg\.pl)/gi, label: 'placeholder image service' },
  { regex: /(picsum\.photos|source\.unsplash\.com\/[^"'`\s]*random)/gi, label: 'random stock image' },
  { regex: /["'`]\/?(placeholder|placehold|dummy|sample)[^"'`/]*\.(png|jpe?g|webp|gif|svg)["'`]/gi, label: 'placeholder image asset' },
  { regex: /\bsrc\s*=\s*["'`]\s*["'`]/gi, label: 'empty image src' },
  { regex: /\balt\s*=\s*["'`](placeholder|todo|image|photo|logo)["'`]/gi, label: 'placeholder alt text' },
];

const AI_TELLS = [
  /\bin today'?s (fast[- ]paced|ever[- ]changing|digital) world\b/gi,
  /\bunlock (the|your) (full )?(power|potential)\b/gi,
  /\btake (it|your [\w ]+) to the next level\b/gi,
  /\b(game[- ]changer|cutting[- ]edge|revolutionary|next[- ]generation)\b/gi,
  /\bseamlessly (integrate|connect|blend|sync)\b/gi,
  /\belevate your\b/gi,
  /\bempower (your|businesses|teams)\b/gi,
  /\bdelve into\b/gi,
  /\bnot just (a|another) [\w ]+, it'?s\b/gi,
  /\bwhether you'?re a [\w ]+ or a [\w ]+\b/gi,
  /\bsay goodbye to\b/gi,
  /\bthe future of [\w ]+ is here\b/gi,
];

const UNSUBSTANTIATED = [
  { regex: /\btrusted by [\d,.]+(\+)?\s*(users|customers|companies|teams|businesses)?/gi, label: 'unsourced social proof' },
  { regex: /\b[\d,.]+(\+)?\s*(million|thousand|k)?\+?\s*(users|customers|downloads|installs)\b/gi, label: 'unsourced usage number' },
  { regex: /\b(award[- ]winning|industry[- ]leading|world[- ]class|best[- ]in[- ]class|market[- ]leading)\b/gi, label: 'unsourced superlative' },
  { regex: /\b(99\.9|100)% (uptime|satisfaction|accuracy)\b/gi, label: 'unsourced metric' },
  { regex: /\b#1 (in|rated|platform|app)\b/gi, label: 'unsourced ranking' },
  { regex: /\bas (seen|featured) (in|on)\b/gi, label: 'unsourced press claim' },
];

export const contentRules = [
  {
    id: 'placeholder-copy',
    category: 'content',
    impact: 'demo-content',
    severity: { relaxed: 'warn', standard: 'error', strict: 'error' },
    description: 'Placeholder or unfinished copy shipped in the product surface.',
    hint: 'Replace the placeholder with real product copy, or remove the unfinished section. Do not ship "coming soon" as a feature.',
    run(ctx) {
      for (const file of uiFiles(ctx)) {
        const seen = new Set();
        for (const pattern of PLACEHOLDER_COPY) {
          forEachMatch(file, pattern.regex, (match, end) => {
            if (isNegated(file.text, match.index)) return;
            const key = `${match.index}`;
            if (seen.has(key)) return;
            seen.add(key);
            ctx.report({
              file,
              index: match.index,
              message: `Placeholder copy (${pattern.label}): "${match[0].replace(/\s+/g, ' ')}".`,
              data: { label: pattern.label },
            });
            void end;
          });
        }
      }
    },
  },
  {
    id: 'template-boilerplate',
    category: 'content',
    impact: 'demo-content',
    severity: { relaxed: 'warn', standard: 'error', strict: 'error' },
    description: 'Default framework starter content left visible to users.',
    hint: 'Delete the generated starter screen and build the real first screen. Starter content is proof the scaffold was never finished.',
    run(ctx) {
      for (const file of uiFiles(ctx)) {
        const seen = new Set();
        for (const pattern of TEMPLATE_BOILERPLATE) {
          forEachMatch(file, pattern.regex, (match) => {
            const key = `${pattern.label}|${match.index}`;
            if (seen.has(key)) return;
            seen.add(key);
            ctx.report({
              file,
              index: match.index,
              message: `Framework starter content is still rendered (${pattern.label}).`,
            });
          });
        }
      }
    },
  },
  {
    id: 'placeholder-identity',
    category: 'content',
    impact: 'demo-content',
    severity: { relaxed: 'info', standard: 'warn', strict: 'error' },
    description: 'Sample names, brands, emails, addresses or phone numbers left in product surfaces.',
    hint: 'Use the real product identity. If this is intentional demo content, mark the file as a fixture and suppress with a reason.',
    run(ctx) {
      for (const file of appFiles(ctx)) {
        if (!file.isSource && !file.isContent) continue;
        const seen = new Set();
        for (const pattern of PLACEHOLDER_IDENTITY) {
          forEachMatch(file, pattern.regex, (match) => {
            if (seen.has(match.index)) return;
            seen.add(match.index);
            if (/example\.com/.test(match[0]) && /(test|fixture|seed|docs?)\//i.test(file.rel)) return;
            ctx.report({
              file,
              index: match.index,
              message: `Sample identity left in product code: "${match[0]}".`,
              data: { label: pattern.label },
            });
          });
        }
      }
    },
  },
  {
    id: 'placeholder-media',
    category: 'content',
    impact: 'demo-content',
    severity: { relaxed: 'warn', standard: 'error', strict: 'error' },
    description: 'Placeholder or random image sources used instead of real assets.',
    hint: 'Add the real asset. Placeholder image services and empty src values break the production experience.',
    run(ctx) {
      for (const file of uiFiles(ctx)) {
        const seen = new Set();
        for (const pattern of PLACEHOLDER_MEDIA) {
          forEachMatch(file, pattern.regex, (match) => {
            if (seen.has(match.index)) return;
            seen.add(match.index);
            ctx.report({
              file,
              index: match.index,
              message: `Placeholder media (${pattern.label}): "${match[0]}".`,
              data: { label: pattern.label },
            });
          });
        }
      }
    },
  },
  {
    id: 'ai-tell-phrases',
    category: 'content',
    impact: 'demo-content',
    severity: { relaxed: 'off', standard: 'warn', strict: 'warn' },
    description: 'Marketing filler that makes the product read like generated copy.',
    hint: 'Replace generic hype with specific, verifiable product language. Name the mechanism, the user, and the outcome.',
    run(ctx) {
      for (const file of uiFiles(ctx)) {
        for (const regex of AI_TELLS) {
          forEachMatch(file, regex, (match) => {
            if (isNegated(file.text, match.index)) return;
            ctx.report({
              file,
              index: match.index,
              message: `Generic AI-style marketing phrase: "${match[0]}".`,
            });
          });
        }
      }
    },
  },
  {
    id: 'unsubstantiated-claims',
    category: 'content',
    impact: 'demo-content',
    severity: { relaxed: 'info', standard: 'warn', strict: 'warn' },
    description: 'Social proof or performance claims with no visible source.',
    hint: 'Link the claim to real data, a testimonial, or remove it. Invented numbers are a trust problem, not a design choice.',
    run(ctx) {
      for (const file of uiFiles(ctx)) {
        for (const pattern of UNSUBSTANTIATED) {
          forEachMatch(file, pattern.regex, (match) => {
            if (isNegated(file.text, match.index)) return;
            ctx.report({
              file,
              index: match.index,
              message: `Unsubstantiated claim (${pattern.label}): "${match[0]}".`,
              data: { label: pattern.label },
            });
          });
        }
      }
    },
  },
];

function isNegated(text, index) {
  const before = text.slice(Math.max(0, index - 60), index).toLowerCase();
  return /\b(no|not|without|never|don't|doesn't|isn't|aren't|avoid|remove|no longer)\b[^.!?\n]{0,40}$/.test(before);
}
