import * as vscode from 'vscode';
import { findOrphans } from './detector.js';
import { killOrphans } from './killer.js';
import { UI } from './ui.js';

let ui: UI | undefined;

async function runCleanup(): Promise<void> {
    if (!ui) { return; }

    ui.log('Scanning for orphaned processes...');

    const result = findOrphans(process.pid);

    if (!result) {
        ui.log('Could not determine process tree — not on a supported remote host?');
        ui.setClean();
        return;
    }

    ui.log(`Server PID: ${result.serverPid}, found ${result.orphans.length} orphan(s)`);

    if (result.orphans.length === 0) {
        ui.log('No orphans found.');
        ui.setClean();
        return;
    }

    for (const orphan of result.orphans) {
        ui.log(`  Orphan: PID ${orphan.pid} (${orphan.type}), RSS ~${Math.round(orphan.rssBytes / (1024 * 1024))}MB`);
    }

    const killResult = await killOrphans(result.orphans);
    ui.showCleanupResult(killResult);
}

export function activate(context: vscode.ExtensionContext): void {
    ui = new UI();
    ui.log('Extension activated.');

    const command = vscode.commands.registerCommand(
        'remoteProcessCleanup.cleanNow',
        () => runCleanup()
    );

    context.subscriptions.push(command);
    context.subscriptions.push({ dispose: () => ui?.dispose() });

    // Run cleanup on activation
    runCleanup();
}

export function deactivate(): void {
    ui?.dispose();
    ui = undefined;
}
