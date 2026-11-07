
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const users = await p.user.findMany({ select: { id: true, email: true, name: true, tier: true } });
const tables = await p.$queryRawUnsafe("select table_name from information_schema.tables where table_schema='public' order by table_name");
console.log(JSON.stringify({ users, tables: tables.map(t=>t.table_name) }, null, 1));
await p.$disconnect();
