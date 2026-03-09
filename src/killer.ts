import { type ProcessInfo } from './detector.js';

const DEFAULT_GRACE_MS = 2000;

export interface KillResult {
    killed: number;
    totalRssFreed: number;
    errors: Array<{ pid: number; error: string }>;
    details: Array<{ pid: number; type: string; signal: string }>;
}

export interface KillOptions {
    killFn?: (pid: number, signal: string) => boolean;
    isAliveFn?: (pid: number) => boolean;
    graceMs?: number;
}

function defaultKill(pid: number, signal: string): boolean {
    try {
        process.kill(pid, signal);
        return true;
    } catch {
        return false;
    }
}

function defaultIsAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function killOrphans(
    orphans: ProcessInfo[],
    options: KillOptions = {},
): Promise<KillResult> {
    const killFn = options.killFn ?? defaultKill;
    const isAliveFn = options.isAliveFn ?? defaultIsAlive;
    const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;

    const result: KillResult = {
        killed: 0,
        totalRssFreed: 0,
        errors: [],
        details: [],
    };

    if (orphans.length === 0) { return result; }

    // Phase 1: SIGTERM all orphans
    const termed: ProcessInfo[] = [];
    for (const orphan of orphans) {
        try {
            killFn(orphan.pid, 'SIGTERM');
            termed.push(orphan);
            result.details.push({ pid: orphan.pid, type: orphan.type, signal: 'SIGTERM' });
        } catch (err) {
            result.errors.push({ pid: orphan.pid, error: String(err) });
        }
    }

    // Phase 2: Wait grace period, then SIGKILL survivors
    if (termed.length > 0) {
        await sleep(graceMs);

        for (const orphan of termed) {
            try {
                if (isAliveFn(orphan.pid)) {
                    killFn(orphan.pid, 'SIGKILL');
                    result.details.push({ pid: orphan.pid, type: orphan.type, signal: 'SIGKILL' });
                }
            } catch (err) {
                result.errors.push({ pid: orphan.pid, error: String(err) });
            }
            result.killed++;
            result.totalRssFreed += orphan.rssBytes;
        }
    }

    return result;
}
