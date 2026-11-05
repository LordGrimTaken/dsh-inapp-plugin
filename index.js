/**
 * Game Lab - an in-app Android emulator for testing the games you build.
 *
 * Host half:
 *   - owns one low-spec, headless AVD (boot on demand, idle shutdown)
 *   - streams its screen and forwards touch input over plugin-owned
 *     webserver routes (no extra port, no adb in the browser)
 *   - scans the configured folders for game APKs / Gradle projects, and can
 *     build a project, install it and launch it in one action
 *
 * Client half (client.js): a full page in the DSH Web UI with a sidebar icon.
 */

import { GameLab } from './host/emulator.js'
import { mountRoutes } from './host/routes.js'

/** The page needs the DSH webserver routes; without it this plugin is inert. */
export const inject = ['webServer']

export function apply(ctx, config) {
  const lab = new GameLab(ctx, config)
  ctx.effect(() => {
    lab.begin()
    const disposeRoutes = mountRoutes(ctx.webServer, lab)
    return () => {
      try {
        disposeRoutes()
      } catch {
        // Routes may already be gone during shutdown.
      }
      lab.dispose().catch(() => {})
    }
  })
}
