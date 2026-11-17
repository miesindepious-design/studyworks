
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const tables = await p.$queryRawUnsafe(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`);
console.log('TABLES:', tables.map(t => t.table_name).join(', '));
try {
  const m = await p.$queryRawUnsafe(`SELECT migration_name, finished_at IS NOT NULL AS done FROM _prisma_migrations ORDER BY started_at`);
  console.log('MIGRATIONS:', JSON.stringify(m));
} catch (e) { console.log('MIGRATIONS_ERR:', e.message); }
const gr = await p.gameRoom.findMany({ take: 5, select: { code: true, status: true } });
console.log('GAMEROOMS:', JSON.stringify(gr));
await p.$disconnect();
