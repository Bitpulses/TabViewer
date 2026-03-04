import * as vscode from 'vscode';
import { TabViewerViewProvider } from './tabViewerViewProvider';

export function activate(context: vscode.ExtensionContext) {
    const provider = new TabViewerViewProvider(context.extensionUri);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            TabViewerViewProvider.viewType,
            provider,
            {
                webviewOptions: {
                    retainContextWhenHidden: true
                }
            }
        )
    );

    context.subscriptions.push(provider);

    context.subscriptions.push(
        vscode.commands.registerCommand('tabViewer.refresh', () => {
            provider.refresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('tabViewer.navigateUp', () => {
            provider.navigateUp();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('tabViewer.navigateDown', () => {
            provider.navigateDown();
        })
    );
}

export function deactivate() {}
