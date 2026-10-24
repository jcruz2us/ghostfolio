import fs from 'node:fs';
import path from 'node:path';

const apiDir = '/ghostfolio/apps/api';

// 1. Patch prisma/schema.prisma for SQLite
const schemaPath = path.join(apiDir, 'prisma', 'schema.prisma');
let schema = fs.readFileSync(schemaPath, 'utf8');
schema = schema.replace(
  'binaryTargets   = ["debian-openssl-3.0.x", "linux-arm64-openssl-3.0.x", "native"]',
  'binaryTargets   = ["native"]'
);
schema = schema.replace('provider = "postgresql"', 'provider = "sqlite"');
schema = schema.replace(
  /scopes\s+String\[\]\s+@default\(\[\]\)/g,
  'scopes        Json?'
);
schema = schema.replace(
  /settings\s+Json\s+@default\("\{\}"\)/g,
  'settings      Json?'
);
schema = schema.replace(/@default\("\[\]"\)/g, '');
schema = schema.replace(/@default\("\{\}"\)/g, '');

fs.writeFileSync(schemaPath, schema, 'utf8');
console.log('[+] Patched prisma/schema.prisma for SQLite');

// Remove Postgres-specific migrations folder so `prisma db push` manages schema cleanly
const migrationsDir = path.join(apiDir, 'prisma', 'migrations');
if (fs.existsSync(migrationsDir)) {
  fs.rmSync(migrationsDir, { recursive: true, force: true });
  console.log('[+] Removed Postgres migrations folder');
}

// 1b. Patch prisma/seed.mts to remove skipDuplicates: true
const seedPath = path.join(apiDir, 'prisma', 'seed.mts');
if (fs.existsSync(seedPath)) {
  let seed = fs.readFileSync(seedPath, 'utf8');
  seed = seed.replace(/,\s*skipDuplicates:\s*true/g, '');
  fs.writeFileSync(seedPath, seed, 'utf8');
  console.log('[+] Patched prisma/seed.mts to remove skipDuplicates');
}

// 2. Patch @prisma/adapter-better-sqlite3 to translate INSERT INTO "MarketData"|"Tag" into INSERT OR IGNORE INTO
const sqliteAdapterDist = path.join(
  apiDir,
  'node_modules',
  '@prisma',
  'adapter-better-sqlite3',
  'dist'
);
for (const file of ['index.js', 'index.mjs']) {
  const p = path.join(sqliteAdapterDist, file);
  if (fs.existsSync(p)) {
    let content = fs.readFileSync(p, 'utf8');
    content = content.replace(
      /this\.client\.prepare\(query\.sql\)/g,
      'this.client.prepare(query.sql.replace(/^INSERT INTO ("(?:MarketData|Tag)")\\b/, "INSERT OR IGNORE INTO $1"))'
    );
    fs.writeFileSync(p, content, 'utf8');
  }
}
console.log('[+] Patched @prisma/adapter-better-sqlite3 with INSERT OR IGNORE support for MarketData & Tag');

// 2b. Shim @prisma/adapter-pg -> @prisma/adapter-better-sqlite3
const adapterPgDist = path.join(apiDir, 'node_modules', '@prisma', 'adapter-pg', 'dist');
const cjsShim = `
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
class PrismaPg extends PrismaBetterSqlite3 {
  constructor(opts) {
    const url = opts?.connectionString || opts?.url || process.env.DATABASE_URL || 'file:/data/ghostfolio.db';
    super({ url });
  }
}
module.exports = { PrismaPg };
`;
const esmShim = `
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
export class PrismaPg extends PrismaBetterSqlite3 {
  constructor(opts) {
    const url = opts?.connectionString || opts?.url || process.env.DATABASE_URL || 'file:/data/ghostfolio.db';
    super({ url });
  }
}
`;
fs.writeFileSync(path.join(adapterPgDist, 'index.js'), cjsShim.trim() + '\n', 'utf8');
fs.writeFileSync(path.join(adapterPgDist, 'index.mjs'), esmShim.trim() + '\n', 'utf8');
console.log('[+] Shimmed @prisma/adapter-pg -> @prisma/adapter-better-sqlite3');

// 3. Patch compiled main.js for SQLite compatibility
const mainJsPath = path.join(apiDir, 'main.js');
let mainJs = fs.readFileSync(mainJsPath, 'utf8');

// 3a. Strip Postgres-only `mode:"insensitive",` (SQLite LIKE is case-insensitive for ASCII by default)
const insensitiveCount = (mainJs.match(/mode:"insensitive",/g) || []).length;
mainJs = mainJs.replace(/mode:"insensitive",/g, '');
console.log(`[+] Stripped ${insensitiveCount} occurrences of mode:"insensitive" from main.js`);

// 3b. Strip `skipDuplicates:!0` from createMany calls (handled by INSERT OR IGNORE in adapter)
const skipDupCount = (mainJs.match(/,skipDuplicates:!0/g) || []).length;
mainJs = mainJs.replace(/,skipDuplicates:!0/g, '');
console.log(`[+] Stripped ${skipDupCount} occurrences of skipDuplicates:!0 from main.js`);

// 3c. Replace the single Postgres-specific $queryRaw in DataProviderService.getHistorical with Prisma findMany
const rawQueryRegex = /const r=e\.map\(\(\{dataSource:e,symbol:t\}\)=>La\.Prisma\.sql`\(\$\{e\}::"DataSource", \$\{t\}\)`\);try\{o=\(await\(this\.prismaService\.\$queryRaw`[\s\S]*?ORDER BY date;`\)\)\.reduce/;

const replacementQuery = `try{o=(await this.prismaService.marketData.findMany({select:{dataSource:!0,date:!0,marketPrice:!0,symbol:!0},where:{OR:e.map(({dataSource:e,symbol:t})=>({dataSource:e,symbol:t})),date:{gte:new Date((0,bt.format)(t,_t,{in:Lt.utc})),lte:new Date((0,bt.format)(a,_t,{in:Lt.utc}))}},orderBy:{date:"asc"}})).reduce`;

if (!rawQueryRegex.test(mainJs)) {
  throw new Error('Failed to locate $queryRaw pattern in main.js');
}
mainJs = mainJs.replace(rawQueryRegex, replacementQuery);
console.log('[+] Replaced Postgres $queryRaw in DataProviderService.getHistorical with native Prisma findMany');

fs.writeFileSync(mainJsPath, mainJs, 'utf8');
console.log('[+] Successfully patched main.js for SQLite');
