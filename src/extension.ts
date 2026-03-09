import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
    console.log('Remote Process Cleanup: activated');
}

export function deactivate(): void {
    // cleanup
}
