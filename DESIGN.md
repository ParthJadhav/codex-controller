# Codex Controller Design System

## Intent

A dense, restrained macOS control workspace built around a large, front-facing DualSense. The visual hierarchy is hardware first, current task second, configuration third. Dark mode is the primary physical scene because the controller is used beside a bright code or chat surface and the white shell needs controlled contrast.

## Color

Use OKLCH tokens throughout the renderer.

- Canvas: `oklch(0.115 0.012 265)`
- Sidebar: `oklch(0.135 0.014 265)`
- Surface: `oklch(0.165 0.014 265)`
- Raised surface: `oklch(0.195 0.016 265)`
- Inset: `oklch(0.125 0.012 265)`
- Border: `oklch(0.78 0.025 265 / 0.16)`
- Primary text: `oklch(0.965 0.008 265)`
- Secondary text: `oklch(0.73 0.022 265)`
- Accent / Codex: `oklch(0.66 0.20 264)`
- Voice: `oklch(0.67 0.22 302)`
- Actions: `oklch(0.75 0.15 212)`
- Attention: `oklch(0.78 0.16 72)`
- Success: `oklch(0.75 0.16 151)`
- Failure: `oklch(0.65 0.23 25)`

Accent is reserved for current selection, the primary action, keyboard focus, and live status. Inactive controller symbols use a quiet cool neutral rather than full saturation.

## Typography

Use `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif`. UI labels remain between 11px and 15px. Primary view titles are 17px semibold; panel titles are 14px semibold. Numeric battery, duration, and diagnostics values use tabular figures. Avoid display typography.

## Layout

- Titlebar/command bar: 64px.
- Sidebar: 188px default, collapses below 980px.
- Inspector: 312px default, moves below the stage below 900px.
- Main stage owns remaining space and never becomes smaller than 420px tall on desktop.
- A compact caption band under the stage names the hovered or selected control and its mapping. The
  voice composer that once sat there has been removed along with in-app dictation; the stage keeps
  the room.
- Spacing follows a 4px base with 8, 12, 16, 20, and 24px steps.

The controller should be fully visible with room for its handles, but large enough that face buttons remain easy to target. The stage has no category legend; state appears on the model and in accessible status copy.

## Components

Controls use 8–12px radii. Cards top out at 14px. Buttons have default, hover, focus-visible, active, disabled, and busy states. The mapping inspector uses native selects, text fields, toggles, and progressive sections instead of modal editors. Notifications use Sonner.

The 3D stage exposes each control through both ray-cast mesh interaction and an offscreen semantic button list. Selection uses emissive material plus a subtle scale/press response on the actual mesh-derived surface. Focus uses a visible in-scene ring and DOM focus outline.

## Motion

State transitions run for 160–220ms with ease-out-quart timing. Controller hover, selection, press depth, inspector changes, and status-light color may animate. Page-load choreography is prohibited. Reduced motion disables camera easing, press scaling, and panel transitions.

## Responsive Behavior

At compact widths the sidebar becomes a toolbar menu and the inspector follows the stage. Nothing relies on hover. Pointer targets are at least 36px and touch/coarse-pointer targets are at least 44px. The app remains usable at 1024×640 and scales cleanly through large desktop windows.
