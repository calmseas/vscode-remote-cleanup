import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { readPpid, getChildPids, classifyProcess, findOrphans, type ProcessInfo } from '../detector.js';

function createFakeProc(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-proc-'));
    return dir;
}

function addFakeProcess(
    procPath: string,
    pid: number,
    ppid: number,
    cmdline: string[],
    rssPages: number = 1000
): void {
    const pidDir = path.join(procPath, String(pid));
    fs.mkdirSync(pidDir, { recursive: true });
    const stat = `${pid} (node) S ${ppid} ${pid} ${pid} 0 -1 4194304 0 0 0 0 0 0 0 0 20 0 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0`;
    fs.writeFileSync(path.join(pidDir, 'stat'), stat);
    fs.writeFileSync(path.join(pidDir, 'cmdline'), cmdline.join('\0') + '\0');
    fs.writeFileSync(path.join(pidDir, 'statm'), `${rssPages * 2} ${rssPages} 500 100 0 800 0`);
}

function cleanupFakeProc(procPath: string): void {
    fs.rmSync(procPath, { recursive: true, force: true });
}

describe('readPpid', () => {
    let procPath: string;
    before(() => {
        procPath = createFakeProc();
        addFakeProcess(procPath, 100, 1, ['node', 'server-main.js']);
        addFakeProcess(procPath, 200, 100, ['node', 'bootstrap-fork', '--type=extensionHost']);
    });
    after(() => cleanupFakeProc(procPath));

    it('reads parent PID from /proc/<pid>/stat', () => {
        const ppid = readPpid(200, procPath);
        assert.strictEqual(ppid, 100);
    });

    it('returns undefined for non-existent PID', () => {
        const ppid = readPpid(999, procPath);
        assert.strictEqual(ppid, undefined);
    });
});

describe('classifyProcess', () => {
    it('identifies extensionHost', () => {
        assert.strictEqual(classifyProcess(['node', 'bootstrap-fork', '--type=extensionHost']), 'extensionHost');
    });
    it('identifies fileWatcher', () => {
        assert.strictEqual(classifyProcess(['node', 'bootstrap-fork', '--type=fileWatcher']), 'fileWatcher');
    });
    it('identifies ptyHost', () => {
        assert.strictEqual(classifyProcess(['node', 'bootstrap-fork', '--type=ptyHost']), 'ptyHost');
    });
    it('identifies server', () => {
        assert.strictEqual(classifyProcess(['node', 'server-main.js', '--start-server']), 'server');
    });
    it('returns unknown for unrecognised', () => {
        assert.strictEqual(classifyProcess(['node', 'something-else.js']), 'unknown');
    });
});

describe('getChildPids', () => {
    let procPath: string;
    before(() => {
        procPath = createFakeProc();
        addFakeProcess(procPath, 100, 1, ['node', 'server-main.js']);
        addFakeProcess(procPath, 200, 100, ['node', 'bootstrap-fork', '--type=extensionHost']);
        addFakeProcess(procPath, 300, 100, ['node', 'bootstrap-fork', '--type=fileWatcher']);
        addFakeProcess(procPath, 400, 100, ['node', 'bootstrap-fork', '--type=ptyHost']);
        addFakeProcess(procPath, 500, 200, ['node', 'tsserver.js']);
    });
    after(() => cleanupFakeProc(procPath));

    it('finds all direct children of a PID', () => {
        const children = getChildPids(100, procPath);
        assert.deepStrictEqual(children.sort(), [200, 300, 400]);
    });
    it('returns empty for PID with no children', () => {
        const children = getChildPids(500, procPath);
        assert.deepStrictEqual(children, []);
    });
});

describe('findOrphans', () => {
    let procPath: string;
    before(() => {
        procPath = createFakeProc();
        addFakeProcess(procPath, 100, 1, ['node', 'server-main.js', '--start-server']);
        addFakeProcess(procPath, 200, 100, ['node', 'bootstrap-fork', '--type=extensionHost'], 5000);
        addFakeProcess(procPath, 201, 100, ['node', 'bootstrap-fork', '--type=extensionHost'], 8000);
        addFakeProcess(procPath, 301, 100, ['node', 'bootstrap-fork', '--type=fileWatcher'], 2000);
        addFakeProcess(procPath, 400, 100, ['node', 'bootstrap-fork', '--type=ptyHost'], 1000);
        addFakeProcess(procPath, 501, 201, ['node', 'tsserver.js'], 3000);
    });
    after(() => cleanupFakeProc(procPath));

    it('identifies orphaned extensionHost processes but not fileWatchers', () => {
        const result = findOrphans(200, procPath);
        assert.ok(result);
        assert.strictEqual(result.serverPid, 100);
        const orphanPids = result.orphans.map(o => o.pid).sort();
        assert.deepStrictEqual(orphanPids, [201]);
    });
    it('never includes current PID in orphans', () => {
        const result = findOrphans(200, procPath);
        assert.ok(result);
        assert.ok(!result.orphans.some(o => o.pid === 200));
    });
    it('never includes ptyHost in orphans', () => {
        const result = findOrphans(200, procPath);
        assert.ok(result);
        assert.ok(!result.orphans.some(o => o.type === 'ptyHost'));
    });
    it('includes descendant RSS in total', () => {
        const result = findOrphans(200, procPath);
        assert.ok(result);
        // Orphan ext host (8000 pages) + its child tsserver (3000 pages)
        // All × PAGE_SIZE (4096) = 45,056,000
        assert.strictEqual(result.totalRssBytes, (8000 + 3000) * 4096);
    });
    it('never includes fileWatcher in orphans', () => {
        const result = findOrphans(200, procPath);
        assert.ok(result);
        assert.ok(!result.orphans.some(o => o.type === 'fileWatcher'));
    });
    it('returns undefined when parent is not server-main.js', () => {
        const result = findOrphans(501, procPath);
        assert.strictEqual(result, undefined);
    });
});

describe('findOrphans — single session (no orphans)', () => {
    let procPath: string;
    before(() => {
        procPath = createFakeProc();
        addFakeProcess(procPath, 100, 1, ['node', 'server-main.js', '--start-server']);
        addFakeProcess(procPath, 200, 100, ['node', 'bootstrap-fork', '--type=extensionHost'], 5000);
        addFakeProcess(procPath, 300, 100, ['node', 'bootstrap-fork', '--type=fileWatcher'], 2000);
        addFakeProcess(procPath, 400, 100, ['node', 'bootstrap-fork', '--type=ptyHost'], 1000);
    });
    after(() => cleanupFakeProc(procPath));

    it('finds zero orphans when only one extensionHost exists', () => {
        const result = findOrphans(200, procPath);
        assert.ok(result);
        assert.strictEqual(result.orphans.length, 0);
        assert.strictEqual(result.totalRssBytes, 0);
    });
});
