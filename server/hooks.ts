import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Claude Code reports what it is doing through HTTP hooks injected with
 * `--settings`. They add to the user's own hooks instead of replacing them.
 * Each session gets its id and a secret token through environment variables,
 * which Claude Code interpolates into the request headers.
 */

export type Activity = 'starting' | 'working' | 'waiting' | 'idle';

export interface ActivityUpdate {
  activity: Activity;
  /** Short text explaining why the session needs you. */
  detail?: string;
}

// Tools that stop and wait for an answer from the user.
const ASKING_TOOLS = 'AskUserQuestion|ExitPlanMode';
// Notification types that mean the session is blocked on the user.
const WAITING_NOTIFICATIONS = new Set([
  'permission_prompt',
  'elicitation_dialog',
  'elicitation_url_dialog',
  'agent_needs_input',
]);

export function writeHookSettings(dir: string, port: number): string {
  const hook = {
    type: 'http',
    url: `http://127.0.0.1:${port}/api/hook`,
    timeout: 5,
    headers: {
      'X-AgentHub-Session': '$AGENTHUB_SESSION_ID',
      Authorization: 'Bearer $AGENTHUB_TOKEN',
    },
    allowedEnvVars: ['AGENTHUB_SESSION_ID', 'AGENTHUB_TOKEN'],
  };
  const on = (matcher?: string) => [{ ...(matcher ? { matcher } : {}), hooks: [hook] }];

  const settings = {
    hooks: {
      UserPromptSubmit: on(),
      PreToolUse: on(ASKING_TOOLS),
      PermissionRequest: on(),
      PostToolUse: on(),
      Notification: on([...WAITING_NOTIFICATIONS].join('|')),
      Stop: on(),
      StopFailure: on(),
      PostModelSwitch: on(),
    },
  };

  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'claude-hooks.json');
  writeFileSync(file, JSON.stringify(settings, null, 2));
  return file;
}

/** Maps a hook payload to the session's new activity, or null to ignore it. */
export function activityFromHook(payload: any): ActivityUpdate | null {
  switch (payload?.hook_event_name) {
    case 'UserPromptSubmit':
    case 'PostToolUse':
      return { activity: 'working' };
    case 'PreToolUse':
      return { activity: 'waiting', detail: payload.tool_name === 'ExitPlanMode' ? 'Plan ready for review' : 'Claude has a question' };
    case 'PermissionRequest':
      return { activity: 'waiting', detail: payload.tool_name ? `Permission to use ${payload.tool_name}` : 'Permission needed' };
    case 'Notification':
      if (!WAITING_NOTIFICATIONS.has(payload.notification_type)) return null;
      return { activity: 'waiting', detail: payload.message || 'Needs your input' };
    case 'Stop':
      return { activity: 'idle' };
    case 'StopFailure':
      return { activity: 'idle', detail: `Stopped: ${String(payload.error ?? 'error').replace(/_/g, ' ')}` };
    default:
      return null;
  }
}
