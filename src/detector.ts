import * as fs from 'node:fs';
import * as path from 'node:path';

const DEFAULT_PROC_PATH = '/proc';
const PAGE_SIZE = 4096;

export interface ProcessInfo {
    pid: number;
    ppid: number;
    cmdline: string[];
    type: 'extensionHost' | 'fileWatcher' | 'ptyHost' | 'server' | 'unknown';
    rssBytes: number;
}

export function readPpid(pid: number, procPath: string = DEFAULT_PROC_PATH): number | undefined {
    try {
        const stat = fs.readFileSync(path.join(procPath, String(pid), 'stat'), 'utf-8');
        const closeParen = stat.lastIndexOf(')');
        const afterComm = stat.slice(closeParen + 2);
        const fields = afterComm.split(' ');
        return parseInt(fields[1], 10);
    } catch {
        return undefined;
    }
}

export function readCmdline(pid: number, procPath: string = DEFAULT_PROC_PATH): string[] | undefined {
    try {
        const raw = fs.readFileSync(path.join(procPath, String(pid), 'cmdline'), 'utf-8');
        if (!raw) { return undefined; }
        return raw.split('\0').filter(s => s.length > 0);
    } catch {
        return undefined;
    }
}

export function readRssBytes(pid: number, procPath: string = DEFAULT_PROC_PATH): number {
    try {
        const statm = fs.readFileSync(path.join(procPath, String(pid), 'statm'), 'utf-8');
        const resident = parseInt(statm.split(' ')[1], 10);
        return resident * PAGE_SIZE;
    } catch {
        return 0;
    }
}

export function classifyProcess(cmdline: string[]): ProcessInfo['type'] {
    const args = cmdline.join(' ');
    if (args.includes('--type=extensionHost')) { return 'extensionHost'; }
    if (args.includes('--type=fileWatcher')) { return 'fileWatcher'; }
    if (args.includes('--type=ptyHost')) { return 'ptyHost'; }
    if (args.includes('server-main.js')) { return 'server'; }
    return 'unknown';
}

export function getChildPids(parentPid: number, procPath: string = DEFAULT_PROC_PATH): number[] {
    const children: number[] = [];
    try {
        const entries = fs.readdirSync(procPath);
        for (const entry of entries) {
            const pid = parseInt(entry, 10);
            if (isNaN(pid)) { continue; }
            const ppid = readPpid(pid, procPath);
            if (ppid === parentPid) {
                children.push(pid);
            }
        }
    } catch {
        // fail safe — return empty
    }
    return children;
}

export function getProcessInfo(pid: number, procPath: string = DEFAULT_PROC_PATH): ProcessInfo | undefined {
    const ppid = readPpid(pid, procPath);
    const cmdline = readCmdline(pid, procPath);
    if (ppid === undefined || cmdline === undefined) { return undefined; }
    return {
        pid,
        ppid,
        cmdline,
        type: classifyProcess(cmdline),
        rssBytes: readRssBytes(pid, procPath),
    };
}

export interface OrphanResult {
    serverPid: number;
    orphans: ProcessInfo[];
    totalRssBytes: number;
}

export function findOrphans(
    currentPid: number,
    procPath: string = DEFAULT_PROC_PATH,
): OrphanResult | undefined {
    const currentPpid = readPpid(currentPid, procPath);
    if (currentPpid === undefined) { return undefined; }

    const parentInfo = getProcessInfo(currentPpid, procPath);
    if (!parentInfo || parentInfo.type !== 'server') { return undefined; }

    const children = getChildPids(currentPpid, procPath);

    const orphans: ProcessInfo[] = [];
    let totalRssBytes = 0;

    for (const childPid of children) {
        if (childPid === currentPid) { continue; }
        const info = getProcessInfo(childPid, procPath);
        if (!info) { continue; }
        if (info.type === 'extensionHost') {
            const descendants = getDescendants(childPid, procPath);
            for (const desc of descendants) {
                totalRssBytes += desc.rssBytes;
            }
            totalRssBytes += info.rssBytes;
            orphans.push(info);
        }
    }

    return { serverPid: currentPpid, orphans, totalRssBytes };
}

function getDescendants(pid: number, procPath: string): ProcessInfo[] {
    const result: ProcessInfo[] = [];
    const childPids = getChildPids(pid, procPath);
    for (const childPid of childPids) {
        const info = getProcessInfo(childPid, procPath);
        if (info) {
            result.push(info);
            result.push(...getDescendants(childPid, procPath));
        }
    }
    return result;
}
