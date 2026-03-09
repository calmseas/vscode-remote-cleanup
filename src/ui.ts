import * as vscode from 'vscode';
import { type KillResult } from './killer.js';

function formatBytes(bytes: number): string {
    if (bytes < 1024 * 1024) { return `${Math.round(bytes / 1024)}KB`; }
    return `${Math.round(bytes / (1024 * 1024))}MB`;
}

export class UI {
    private statusBarItem: vscode.StatusBarItem;
    private outputChannel: vscode.OutputChannel;

    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            0
        );
        this.statusBarItem.command = 'remoteProcessCleanup.cleanNow';
        this.outputChannel = vscode.window.createOutputChannel('Remote Process Cleanup');
        this.setClean();
        this.statusBarItem.show();
    }

    log(message: string): void {
        const timestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${timestamp}] ${message}`);
    }

    setClean(): void {
        this.statusBarItem.text = '$(check) Remote Clean';
        this.statusBarItem.tooltip = 'No orphaned processes detected. Click to scan.';
    }

    showCleanupResult(result: KillResult): void {
        if (result.killed === 0) {
            this.setClean();
            return;
        }

        const memoryStr = formatBytes(result.totalRssFreed);

        // Status bar — briefly show cleanup result
        this.statusBarItem.text = `$(warning) Cleaned ${result.killed} orphan${result.killed === 1 ? '' : 's'}`;
        this.statusBarItem.tooltip = `Freed ~${memoryStr}. Click to scan again.`;

        // Revert to clean state after 5 seconds
        setTimeout(() => this.setClean(), 5000);

        // Toast notification
        const message = `Killed ${result.killed} orphaned process${result.killed === 1 ? '' : 'es'}, freed ~${memoryStr}`;
        vscode.window.showInformationMessage(message, 'Show Details').then(choice => {
            if (choice === 'Show Details') {
                this.outputChannel.show();
            }
        });

        // Log details to output channel
        this.log(`Cleanup complete: ${result.killed} process(es) killed, ~${memoryStr} freed`);
        for (const detail of result.details) {
            this.log(`  PID ${detail.pid} (${detail.type}) — ${detail.signal}`);
        }
        for (const error of result.errors) {
            this.log(`  ERROR PID ${error.pid}: ${error.error}`);
        }
    }

    dispose(): void {
        this.statusBarItem.dispose();
        this.outputChannel.dispose();
    }
}
