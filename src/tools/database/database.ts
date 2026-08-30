/**
 * Tool: db:* — an in-memory relational store (tables of rows).
 *
 *   db:create   db:insert   db:select   db:delete (DELETE)   db:drop (DROP)
 *
 * `db:delete` and `db:drop` are flagged as dangerous operations by the
 * approval gate; plain reads/writes pass through on permissions alone.
 * A real deployment swaps this for Postgres/SQLite behind the same
 * interface.
 */

import type { Tool, ToolExecutionContext, ToolResult } from '../tool.js';

export class InMemoryDatabase {
  private tables = new Map<string, Array<Record<string, unknown>>>();

  create(name: string): void {
    if (!this.tables.has(name)) this.tables.set(name, []);
  }

  insert(name: string, row: Record<string, unknown>): void {
    if (!this.tables.has(name)) this.tables.set(name, []);
    this.tables.get(name)!.push(row);
  }

  select(name: string, where?: Record<string, unknown>): Array<Record<string, unknown>> {
    const rows = this.tables.get(name) ?? [];
    if (!where || Object.keys(where).length === 0) return [...rows];
    return rows.filter((r) => Object.entries(where).every(([k, v]) => r[k] === v));
  }

  delete(name: string, where: Record<string, unknown>): number {
    const rows = this.tables.get(name) ?? [];
    const keep = rows.filter((r) => !Object.entries(where).every(([k, v]) => r[k] === v));
    this.tables.set(name, keep);
    return rows.length - keep.length;
  }

  drop(name: string): boolean {
    return this.tables.delete(name);
  }

  list(): string[] {
    return [...this.tables.keys()].sort();
  }
}

export function createDatabaseTools(db: InMemoryDatabase): Tool[] {
  return [
    {
      name: 'db:create',
      spec: {
        name: 'db:create',
        description: 'Create an empty table.',
        parameters: { table: { type: 'string', description: 'Table name' } },
      },
      async execute(args): Promise<ToolResult> {
        const table = String(args.table ?? '');
        if (!table) return { ok: false, output: '', error: 'table is required' };
        db.create(table);
        return { ok: true, output: `table "${table}" ready` };
      },
    },
    {
      name: 'db:insert',
      spec: {
        name: 'db:insert',
        description: 'Insert a row into a table.',
        parameters: {
          table: { type: 'string', description: 'Table name' },
          row: { type: 'object', description: 'Row object' },
        },
      },
      async execute(args): Promise<ToolResult> {
        const table = String(args.table ?? '');
        const row = (args.row ?? {}) as Record<string, unknown>;
        if (!table) return { ok: false, output: '', error: 'table is required' };
        db.insert(table, row);
        return { ok: true, output: `inserted into "${table}": ${JSON.stringify(row).slice(0, 200)}` };
      },
    },
    {
      name: 'db:select',
      spec: {
        name: 'db:select',
        description: 'Select rows (optionally filtered by equality).',
        parameters: {
          table: { type: 'string', description: 'Table name' },
          where: { type: 'object', description: 'Optional equality filter' },
        },
      },
      async execute(args): Promise<ToolResult> {
        const table = String(args.table ?? '');
        if (!table) return { ok: false, output: '', error: 'table is required' };
        const rows = db.select(table, (args.where ?? undefined) as Record<string, unknown> | undefined);
        return { ok: true, output: rows.length ? JSON.stringify(rows, null, 1).slice(0, 4000) : `0 rows in "${table}"` };
      },
    },
    {
      name: 'db:delete',
      spec: {
        name: 'db:delete',
        description: 'DELETE rows matching a filter. Dangerous — requires approval.',
        parameters: {
          table: { type: 'string', description: 'Table name' },
          where: { type: 'object', description: 'Equality filter' },
        },
      },
      async execute(args): Promise<ToolResult> {
        const table = String(args.table ?? '');
        const where = (args.where ?? {}) as Record<string, unknown>;
        if (!table) return { ok: false, output: '', error: 'table is required' };
        const n = db.delete(table, where);
        return { ok: true, output: `deleted ${n} row(s) from "${table}"` };
      },
    },
    {
      name: 'db:drop',
      spec: {
        name: 'db:drop',
        description: 'DROP a table entirely. Dangerous — requires approval.',
        parameters: { table: { type: 'string', description: 'Table name' } },
      },
      async execute(args): Promise<ToolResult> {
        const table = String(args.table ?? '');
        if (!table) return { ok: false, output: '', error: 'table is required' };
        const ok = db.drop(table);
        return { ok: true, output: ok ? `dropped "${table}"` : `"${table}" did not exist` };
      },
    },
  ];
}
