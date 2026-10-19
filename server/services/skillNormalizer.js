const ALIAS_MAP = new Map([
  // Frontend
  ['react', 'React'],
  ['react.js', 'React'],
  ['reactjs', 'React'],
  ['react native', 'React Native'],
  ['react-native', 'React Native'],
  ['vue', 'Vue.js'],
  ['vue.js', 'Vue.js'],
  ['vuejs', 'Vue.js'],
  ['angular', 'Angular'],
  ['angularjs', 'Angular'],
  ['angular.js', 'Angular'],
  ['next', 'Next.js'],
  ['next.js', 'Next.js'],
  ['nextjs', 'Next.js'],
  ['svelte', 'Svelte'],
  ['sveltekit', 'SvelteKit'],
  ['tailwind', 'Tailwind CSS'],
  ['tailwindcss', 'Tailwind CSS'],
  ['tailwind css', 'Tailwind CSS'],
  ['html', 'HTML5'],
  ['html5', 'HTML5'],
  ['css', 'CSS3'],
  ['css3', 'CSS3'],
  ['sass', 'Sass'],
  ['scss', 'Sass'],
  ['redux', 'Redux'],
  ['redux toolkit', 'Redux'],
  ['rtk', 'Redux'],

  // Languages – kept distinct from each other
  ['javascript', 'JavaScript'],
  ['js', 'JavaScript'],
  ['es6', 'JavaScript'],
  ['ecmascript', 'JavaScript'],
  ['typescript', 'TypeScript'],
  ['ts', 'TypeScript'],
  ['python', 'Python'],
  ['py', 'Python'],
  ['python3', 'Python'],
  ['golang', 'Go'],
  ['go lang', 'Go'],
  ['go', 'Go'],
  ['java', 'Java'],
  ['c++', 'C++'],
  ['cpp', 'C++'],
  ['c#', 'C#'],
  ['csharp', 'C#'],
  ['ruby', 'Ruby'],
  ['rust', 'Rust'],
  ['php', 'PHP'],
  ['sql', 'SQL'],

  // Backend & runtime
  ['node', 'Node.js'],
  ['nodejs', 'Node.js'],
  ['node.js', 'Node.js'],
  ['express', 'Express.js'],
  ['expressjs', 'Express.js'],
  ['express.js', 'Express.js'],
  ['nest', 'NestJS'],
  ['nestjs', 'NestJS'],
  ['fastapi', 'FastAPI'],
  ['django', 'Django'],
  ['flask', 'Flask'],
  ['spring', 'Spring Boot'],
  ['springboot', 'Spring Boot'],
  ['spring boot', 'Spring Boot'],
  ['rails', 'Ruby on Rails'],
  ['ruby on rails', 'Ruby on Rails'],

  // Databases
  ['postgres', 'PostgreSQL'],
  ['postgresql', 'PostgreSQL'],
  ['psql', 'PostgreSQL'],
  ['mongo', 'MongoDB'],
  ['mongodb', 'MongoDB'],
  ['redis', 'Redis'],
  ['mysql', 'MySQL'],
  ['sqlite', 'SQLite'],
  ['cassandra', 'Cassandra'],
  ['dynamodb', 'DynamoDB'],
  ['elasticsearch', 'Elasticsearch'],

  // DevOps & cloud
  ['docker', 'Docker'],
  ['k8s', 'Kubernetes'],
  ['kubernetes', 'Kubernetes'],
  ['aws', 'AWS'],
  ['amazon web services', 'AWS'],
  ['gcp', 'GCP'],
  ['google cloud', 'GCP'],
  ['google cloud platform', 'GCP'],
  ['azure', 'Azure'],
  ['microsoft azure', 'Azure'],
  ['terraform', 'Terraform'],
  ['ci/cd', 'CI/CD'],
  ['cicd', 'CI/CD'],
  ['ci cd', 'CI/CD'],
  ['git', 'Git'],
  ['github', 'GitHub'],
  ['gitlab', 'GitLab'],

  // APIs & architecture
  ['rest', 'REST APIs'],
  ['restful', 'REST APIs'],
  ['rest api', 'REST APIs'],
  ['restful api', 'REST APIs'],
  ['rest apis', 'REST APIs'],
  ['graphql', 'GraphQL'],
  ['gql', 'GraphQL'],
  ['grpc', 'gRPC'],
  ['kafka', 'Apache Kafka'],
  ['rabbitmq', 'RabbitMQ'],
]);

const CATEGORY_MAP = new Map([
  ['JavaScript', 'Technical'],
  ['TypeScript', 'Technical'],
  ['Python', 'Technical'],
  ['Go', 'Technical'],
  ['Java', 'Technical'],
  ['C++', 'Technical'],
  ['C#', 'Technical'],
  ['SQL', 'Technical'],
  ['HTML5', 'Technical'],
  ['CSS3', 'Technical'],
  ['PostgreSQL', 'Technical'],
  ['MongoDB', 'Technical'],
  ['Redis', 'Technical'],
  ['MySQL', 'Technical'],
  ['React', 'Framework / Tool'],
  ['React Native', 'Framework / Tool'],
  ['Node.js', 'Framework / Tool'],
  ['Next.js', 'Framework / Tool'],
  ['Express.js', 'Framework / Tool'],
  ['Vue.js', 'Framework / Tool'],
  ['Angular', 'Framework / Tool'],
  ['Tailwind CSS', 'Framework / Tool'],
  ['Redux', 'Framework / Tool'],
  ['Docker', 'Framework / Tool'],
  ['Kubernetes', 'Framework / Tool'],
  ['AWS', 'Framework / Tool'],
  ['GCP', 'Framework / Tool'],
  ['Azure', 'Framework / Tool'],
  ['Git', 'Framework / Tool'],
  ['GitHub', 'Framework / Tool'],
  ['CI/CD', 'Framework / Tool'],
  ['REST APIs', 'Framework / Tool'],
  ['GraphQL', 'Framework / Tool'],
]);

// Aliases that are also ordinary English words or too short to search prose for.
// They still normalise a skill name ("go" → "Go"), but never count as a mention in text.
const UNSAFE_IN_TEXT = new Set(['go', 'rust', 'next', 'express', 'rest', 'spring', 'rails', 'nest', 'node', 'js', 'ts', 'py', 'rtk', 'gql', 'mongo']);

// Canonical names that are also common words, so they only match with the exact capitalisation.
const CASE_SENSITIVE = new Set(['Go', 'Rust', 'Swift', 'R', 'C']);

const ALIASES_BY_CANONICAL = new Map();
for (const [alias, canonical] of ALIAS_MAP) {
  if (UNSAFE_IN_TEXT.has(alias)) continue;
  if (!ALIASES_BY_CANONICAL.has(canonical)) ALIASES_BY_CANONICAL.set(canonical, new Set());
  ALIASES_BY_CANONICAL.get(canonical).add(alias);
}

export function normalizeSkill(rawName = '') {
  if (!rawName || typeof rawName !== 'string') return '';
  const cleaned = rawName.replace(/^[-•*#\s]+|[-•*#\s]+$/g, '').replace(/\s+/g, ' ');
  const lower = cleaned.toLowerCase();
  if (ALIAS_MAP.has(lower)) return ALIAS_MAP.get(lower);

  // Only all-lowercase words get a capital, so "IBM ACE 12", "PyTorch" and "iOS" stay as written.
  return cleaned
    .split(' ')
    .map((word) => (word === word.toLowerCase() ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ');
}

// A vendor name in front can be dropped without changing the skill: "IBM MQ" is "MQ".
const VENDOR_PREFIXES = new Set(['ibm', 'websphere', 'microsoft', 'ms', 'apache', 'oracle', 'sap', 'amazon', 'aws', 'google', 'adobe', 'salesforce']);
const VERSION = /^v?\d+(\.\d+)*$/i;
const ACRONYM = /^[A-Z][A-Z0-9]{1,5}$/;
const TRAILING_FILLER = new Set(['api', 'apis', 'framework', 'frameworks', 'library', 'libraries', 'development', 'experience', 'programming']);

// "IBM ACE 12" → IBM ACE 12, IBM ACE, ACE 12, ACE. "IBM Integration Bus" also gives its initials, IIB.
function spellings(name) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  const forms = [words];
  let end = words.length;
  while (end > 1 && VERSION.test(words[end - 1])) end--;
  if (end < words.length) forms.push(words.slice(0, end));

  // "GraphQL APIs" and "React development" are still GraphQL and React.
  for (const form of [...forms]) {
    if (form.length > 1 && TRAILING_FILLER.has(form.at(-1).toLowerCase())) forms.push(form.slice(0, -1));
  }

  for (const form of [...forms]) {
    const rest = form.slice(1);
    // "Oracle Database" keeps its vendor: "Database" alone would match far too much.
    if (rest.length && VENDOR_PREFIXES.has(form[0].toLowerCase()) && (rest.length > 1 || ACRONYM.test(rest[0]))) forms.push(rest);
  }

  const out = forms.map((form) => form.join(' '));
  for (const form of forms) {
    if (form.length >= 3 && form.every((w) => /^[a-z]+$/i.test(w))) out.push(form.map((w) => w[0].toUpperCase()).join(''));
  }
  return out;
}

// "REST/SOAP" means either one; "CI/CD", "TCP/IP" and "PL/SQL" are single names.
function alternatives(text) {
  const pieces = text.split(/\s*\/\s*|\s+or\s+/i).map((p) => p.trim()).filter(Boolean);
  return pieces.length > 1 && pieces.every((p) => p.length >= 3) ? [text, ...pieces] : [text];
}

/**
 * Every reasonable way of writing the same skill, in its original case. Covers versions,
 * vendor prefixes, initials, a bracketed abbreviation ("IBM Integration Bus (IIB)") and
 * either/or lists ("Web Services (REST/SOAP)").
 */
export function skillVariants(name) {
  if (!name || typeof name !== 'string') return [];
  const inside = [...name.matchAll(/\(([^)]+)\)/g)].map((m) => m[1]);
  const outside = name.replace(/\([^)]*\)/g, ' ');

  const variants = new Set();
  for (const part of [outside, ...inside]) {
    for (const option of alternatives(part)) {
      for (const spelling of spellings(option)) {
        if (spelling.length < 2) continue;
        variants.add(spelling);
        const alias = ALIAS_MAP.get(spelling.toLowerCase());
        if (alias) variants.add(alias);
      }
    }
  }
  return [...variants];
}

const matchKeys = (name) => new Set(skillVariants(name).map((v) => v.toLowerCase()));

/** True when two skill names describe the same skill, e.g. "IIB 10" and "IBM Integration Bus (IIB)". */
export function skillsMatch(a, b) {
  const keys = matchKeys(a);
  return skillVariants(b).some((v) => keys.has(v.toLowerCase()));
}

// Broad requirements that a more specific skill partly covers ("Unit Testing" ← Jest).
// Kept short on purpose: only pairings a recruiter would accept without argument.
const RELATED_SKILLS = new Map([
  ['Unit Testing', ['Jest', 'Vitest', 'Mocha', 'React Testing Library', 'Pytest', 'JUnit']],
  ['Testing', ['Jest', 'Vitest', 'Mocha', 'Cypress', 'Playwright', 'React Testing Library', 'Pytest', 'JUnit', 'Selenium']],
  ['End-to-end Testing', ['Cypress', 'Playwright', 'Selenium']],
  ['Cloud', ['AWS', 'GCP', 'Azure']],
  ['Containerization', ['Docker', 'Kubernetes']],
  ['State Management', ['Redux', 'Zustand', 'MobX']],
  ['CI/CD', ['GitHub Actions', 'Jenkins', 'GitLab CI']],
  ['Relational Databases', ['PostgreSQL', 'MySQL', 'SQLite', 'SQL']],
  ['NoSQL', ['MongoDB', 'DynamoDB', 'Cassandra', 'Redis']],
]);

/** Specific skills that partly cover a broad requirement, e.g. "Unit Testing" → Jest, Vitest… */
export function relatedSkills(canonicalSkill) {
  return RELATED_SKILLS.get(canonicalSkill) ?? [];
}

export function inferSkillCategory(canonicalSkill, existingCategory) {
  if (existingCategory && existingCategory !== 'Other') return existingCategory;
  return CATEGORY_MAP.get(canonicalSkill) || 'Technical';
}

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\#]/g, '\\$&');

/**
 * True when the skill appears as a whole term in the text, under any of its variants.
 * "Java" doesn't match "JavaScript", "Go" doesn't match "go to market", and short names
 * like ACE or MQ only count when written as they are, not as the everyday word.
 */
export function isSkillMentionedInText(skill, text) {
  if (!skill || !text) return false;

  const terms = [...skillVariants(skill), ...(ALIASES_BY_CANONICAL.get(normalizeSkill(skill)) ?? [])];
  return terms.some((term) => {
    const exactCase = term.length <= 3 || CASE_SENSITIVE.has(term) || UNSAFE_IN_TEXT.has(term.toLowerCase());
    const spellingsToTry = exactCase ? [...new Set([term, term.toUpperCase()])] : [term];
    return spellingsToTry.some((spelling) => {
      const pattern = new RegExp(`(^|[^a-zA-Z0-9_+#.])${escapeRegex(spelling)}(?=[^a-zA-Z0-9_+#]|\\.(?![a-zA-Z0-9])|$)`, exactCase ? '' : 'i');
      return pattern.test(text);
    });
  });
}
