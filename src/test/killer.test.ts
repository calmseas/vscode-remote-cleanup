import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { killOrphans, type KillResult } from '../killer.js';
import { type ProcessInfo } from '../detector.js';

function makeOrphan(pid: number, type: ProcessInfo['type'] = 'extensionHost'): ProcessInfo {
    return {
        pid,
        ppid: 100,
        cmdline: ['node', 'bootstrap-fork', `--type=${type}`],
        type,
        rssBytes: 4096 * 1000,
    };
}

describe('killOrphans', () => {
    it('sends SIGTERM to all orphan PIDs', async () => {
        const signals: Array<{ pid: number; signal: string }> = [];
        const killFn = (pid: number, signal: string) => {
            signals.push({ pid, signal: String(signal) });
            return true;
        };
        const isAliveFn = (_pid: number) => false;

        const result = await killOrphans(
            [makeOrphan(201), makeOrphan(301, 'fileWatcher')],
            { killFn, isAliveFn, graceMs: 10 }
        );

        assert.strictEqual(result.killed, 2);
        assert.ok(signals.some(s => s.pid === 201 && s.signal === 'SIGTERM'));
        assert.ok(signals.some(s => s.pid === 301 && s.signal === 'SIGTERM'));
    });

    it('sends SIGKILL to survivors after grace period', async () => {
        const signals: Array<{ pid: number; signal: string }> = [];
        const killFn = (pid: number, signal: string) => {
            signals.push({ pid, signal: String(signal) });
            return true;
        };
        const isAliveFn = (_pid: number) => true;

        const result = await killOrphans(
            [makeOrphan(201)],
            { killFn, isAliveFn, graceMs: 10 }
        );

        assert.strictEqual(result.killed, 1);
        assert.ok(signals.some(s => s.pid === 201 && s.signal === 'SIGTERM'));
        assert.ok(signals.some(s => s.pid === 201 && s.signal === 'SIGKILL'));
    });

    it('returns zero killed when list is empty', async () => {
        const result = await killOrphans([], {});
        assert.strictEqual(result.killed, 0);
        assert.strictEqual(result.totalRssFreed, 0);
    });

    it('handles kill errors gracefully', async () => {
        const killFn = (_pid: number, _signal: string) => {
            throw new Error('ESRCH');
        };

        const result = await killOrphans(
            [makeOrphan(201)],
            { killFn, graceMs: 10 }
        );

        assert.strictEqual(result.errors.length, 1);
    });
});
