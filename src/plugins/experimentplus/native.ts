/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IpcMainInvokeEvent, WebContents } from "electron";

const VALID_PANELS = new Set(["elements", "console", "network", "sources"]);

// Panel to show every time DevTools opens (set from the plugin's setting)
const preferredPanel = new WeakMap<WebContents, string>();
// One-shot override used when a specific button was clicked
const nextPanel = new WeakMap<WebContents, string>();
const hooked = new WeakSet<WebContents>();

const MAX_ATTEMPTS = 40;
const RETRY_MS = 100;

function showPanel(wc: WebContents, panel: string, attempt = 0) {
    const retry = () => {
        if (attempt < MAX_ATTEMPTS)
            setTimeout(() => showPanel(wc, panel, attempt + 1), RETRY_MS);
    };

    const dt = wc.devToolsWebContents;
    if (!dt || dt.isDestroyed()) return retry();

    // DevToolsAPI comes from Chromium's devtools_compatibility.js; it forwards
    // showPanel to the frontend once InspectorFrontendAPI exists.
    const script = `(() => {
        try {
            if (document.readyState !== "complete") return false;
            if (typeof InspectorFrontendAPI === "undefined" || typeof DevToolsAPI === "undefined") return false;
            DevToolsAPI.showPanel(${JSON.stringify(panel)});
            // DevTools may restore the last-used tab slightly after load, so select again.
            setTimeout(() => DevToolsAPI.showPanel(${JSON.stringify(panel)}), 300);
            return true;
        } catch {
            return false;
        }
    })()`;

    dt.executeJavaScript(script)
        .then(ok => { if (!ok) retry(); })
        .catch(retry);
}

function ensureHook(wc: WebContents) {
    if (hooked.has(wc)) return;
    hooked.add(wc);

    wc.on("devtools-opened", () => {
        const panel = nextPanel.get(wc) ?? preferredPanel.get(wc);
        nextPanel.delete(wc);
        if (panel && VALID_PANELS.has(panel)) showPanel(wc, panel);
    });
}

export function setDefaultPanel(event: IpcMainInvokeEvent, panel: string) {
    const wc = event.sender;
    ensureHook(wc);
    preferredPanel.set(wc, panel);
}

export function openDevTools(event: IpcMainInvokeEvent, panel: string) {
    if (!VALID_PANELS.has(panel)) return;

    const wc = event.sender;
    ensureHook(wc);

    if (wc.isDevToolsOpened()) {
        showPanel(wc, panel);
        wc.devToolsWebContents?.focus();
    } else {
        nextPanel.set(wc, panel);
        wc.openDevTools();
    }
}
