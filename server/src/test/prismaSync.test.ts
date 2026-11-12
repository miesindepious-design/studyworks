/**
 * The generated Prisma client must match prisma/schema.prisma.
 *
 * This is not a theoretical concern. The schema gained `schoolStage`,
 * `schoolClass`, `universityYear` and `department`, but the generated client
 * was never regenerated. Every request that went through `requireAuth` then
 * failed with:
 *
 *   PrismaClientValidationError: Unknown field `schoolStage` for select
 *   statement on model `User`.
 *
 * Because `requireAuth` guards every authenticated route, that one stale
 * field took down the whole API — support tickets, notes, billing, settings,
 * everything returned HTTP 500 with an empty body. It looked like a broken
 * feature; it was a broken client.
 *
 * The schema alone cannot catch this: `prisma validate` passes happily, and
 * the error only appears at runtime. Comparing the schema's field lists
 * against the DMMF baked into the generated client catches it at build time.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Prisma } from '@prisma/client';

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(here, '../../prisma/schema.prisma');

interface SchemaModel {
  name: string;
  fields: string[];
}

/**
 * Pull the model names and scalar field names out of a Prisma schema.
 *
 * Deliberately simple: it only needs to find `model X { … }` blocks and the
 * field lines inside them. Block attributes (`@@index`) and enum/type blocks
 * are skipped.
 */
function parseSchemaModels(schema: string): SchemaModel[] {
  const models: SchemaModel[] = [];
  const lines = schema.split(/\r?\n/);

  let current: SchemaModel | null = null;

  for (const raw of lines) {
    const line = raw.trim();

    const modelMatch = line.match(/^model\s+(\w+)\s*\{/);
    if (modelMatch) {
      current = { name: modelMatch[1], fields: [] };
      continue;
    }

    if (!current) continue;

    if (line === '}') {
      models.push(current);
      current = null;
      continue;
    }

    // Skip blank lines, comments and block attributes.
    if (!line || line.startsWith('//') || line.startsWith('@@')) continue;

    // A field is `name Type` — optionally with `?` on the type and trailing
    // attributes. Relations are `name Model[]` / `name Model?`.
    const fieldMatch = line.match(/^(\w+)\s+\w+/);
    if (fieldMatch) current.fields.push(fieldMatch[1]);
  }

  return models;
}

describe('Prisma client is in sync with the schema', () => {
  const schema = readFileSync(schemaPath, 'utf-8');
  const schemaModels = parseSchemaModels(schema);
  const clientModels = Prisma.dmmf.datamodel.models;

  it('parses the schema', () => {
    // A silent parser failure would make every assertion below vacuous.
    expect(schemaModels.length).toBeGreaterThan(5);
    expect(schemaModels.map(m => m.name)).toContain('User');
    expect(schemaModels.map(m => m.name)).toContain('SupportTicket');
  });

  it('has a generated client for every model in the schema', () => {
    const clientNames = new Set(clientModels.map(m => m.name));
    for (const model of schemaModels) {
      expect(
        clientNames.has(model.name),
        `the generated client has no model "${model.name}" — run "prisma generate"`,
      ).toBe(true);
    }
  });

  it('has every schema field in the generated client', () => {
    for (const model of schemaModels) {
      const clientModel = clientModels.find(m => m.name === model.name);
      if (!clientModel) continue; // covered by the previous test
      const clientFields = new Set(clientModel.fields.map(f => f.name));
      for (const field of model.fields) {
        expect(
          clientFields.has(field),
          `model "${model.name}" is missing field "${field}" in the generated client ` +
          `— run "prisma generate" (npm run db:generate)`,
        ).toBe(true);
      }
    }
  });

  it('covers the fields the auth middleware selects', () => {
    // These are the fields that broke requireAuth. Naming them here makes the
    // failure mode obvious if the model changes shape again.
    const user = clientModels.find(m => m.name === 'User');
    expect(user).toBeDefined();
    const userFields = new Set(user!.fields.map(f => f.name));
    for (const field of [
      'id', 'email', 'tier',
      'educationLevel', 'schoolStage', 'schoolClass', 'universityYear', 'department',
      'trialStartsAt', 'trialEndsAt',
    ]) {
      expect(
        userFields.has(field),
        `the generated client is missing User.${field} — run "prisma generate"`,
      ).toBe(true);
    }
  });

  it('would actually catch a stale client', () => {
    // A guard that can never fail is worse than no guard, because it looks
    // like coverage. Simulate the original bug — a schema field the client
    // has never heard of — and confirm the comparison rejects it.
    const withGhostField = schema + '\nmodel Ghost {\n  id String @id\n}\n';
    const ghost = parseSchemaModels(withGhostField).find(m => m.name === 'Ghost');
    expect(ghost).toBeDefined();

    const clientNames = new Set(clientModels.map(m => m.name));
    expect(clientNames.has(ghost!.name)).toBe(false);

    // And the field-level check catches a field missing from a known model.
    const user = clientModels.find(m => m.name === 'User')!;
    const clientFields = new Set(user.fields.map(f => f.name));
    expect(clientFields.has('aFieldThatWasNeverGenerated')).toBe(false);
  });
});
