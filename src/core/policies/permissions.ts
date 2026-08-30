/**
 * Tool permissions.
 *
 * Every agent gets an explicit permission map:
 *
 *   permissions: {
 *     webSearch: true,
 *     filesystem: false,
 *     shell: false,
 *     database: false,
 *     externalHttp: true
 *   }
 */

export interface AgentPermissions {
  webSearch: boolean;
  browser: boolean;
  filesystem: boolean;
  code: boolean;
  shell: boolean;
  database: boolean;
  externalHttp: boolean;
}

export const DEFAULT_PERMISSIONS: AgentPermissions = {
  webSearch: true,
  browser: false,
  filesystem: true,
  code: true,
  shell: false,
  database: false,
  externalHttp: true,
};

/** Permissive set for fully-trusted local agents. */
export const TRUSTED_PERMISSIONS: AgentPermissions = {
  webSearch: true,
  browser: true,
  filesystem: true,
  code: true,
  shell: true,
  database: true,
  externalHttp: true,
};

export const TOOL_PERMISSION: Record<string, keyof AgentPermissions> = {
  'web:search': 'webSearch',
  'browser:fetch': 'browser',
  'fs:read': 'filesystem',
  'fs:write': 'filesystem',
  'fs:list': 'filesystem',
  'fs:delete': 'filesystem',
  'code:run': 'code',
  'shell:exec': 'shell',
  'db:select': 'database',
  'db:insert': 'database',
  'db:delete': 'database',
  'db:drop': 'database',
  'db:create': 'database',
  'http:request': 'externalHttp',
};

export interface PermissionDecision {
  allowed: boolean;
  reason?: string;
}

export class PermissionManager {
  private byAgent = new Map<string, AgentPermissions>();

  constructor(private defaults: AgentPermissions = DEFAULT_PERMISSIONS) {}

  forAgent(agentId: string, perms: AgentPermissions): void {
    this.byAgent.set(agentId, perms);
  }

  forRole(role: string): AgentPermissions {
    // Roles get least-privilege defaults; the harness can widen per agent.
    switch (role) {
      case 'researcher':
        return { ...DEFAULT_PERMISSIONS, filesystem: false, code: false, database: false };
      case 'coder':
        return { ...DEFAULT_PERMISSIONS, shell: false, browser: false };
      case 'qa':
        return {
          webSearch: false, browser: false, filesystem: false,
          code: true, shell: true, database: false, externalHttp: false,
        };
      case 'reviewer':
        return { ...DEFAULT_PERMISSIONS, filesystem: false, code: false, shell: false, database: false, webSearch: false, externalHttp: false };
      default:
        return { ...this.defaults };
    }
  }

  check(agentId: string, tool: string): PermissionDecision {
    const perms = this.byAgent.get(agentId) ?? this.defaults;
    const key = TOOL_PERMISSION[tool];
    if (!key) return { allowed: false, reason: `unknown tool "${tool}"` };
    if (!perms[key]) {
      return { allowed: false, reason: `agent "${agentId}" lacks the "${key}" permission for ${tool}` };
    }
    return { allowed: true };
  }

  describe(agentId: string): string {
    const p = this.byAgent.get(agentId) ?? this.defaults;
    return JSON.stringify(p);
  }
}
