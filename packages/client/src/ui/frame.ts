// The game is a fixed 16:9 picture. The 3D view fills a 16:9 frame (black bars around it if the
// window is another shape), and the HUD is laid out at UI_WIDTH x UI_HEIGHT and scaled to the
// frame, so every window size shows the same proportions.

export const UI_WIDTH = 1280;
export const UI_HEIGHT = 720;

/** Keeps --ui-scale on the frame equal to its width over UI_WIDTH. */
export function fitUiToFrame(frame: HTMLElement): void {
  const apply = () => frame.style.setProperty('--ui-scale', String(frame.clientWidth / UI_WIDTH));
  new ResizeObserver(apply).observe(frame);
  apply();
}
