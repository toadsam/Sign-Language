type ViewportRenderer = { setSize: (width: number, height: number, updateStyle: boolean) => void };
type ViewportCamera = { left: number; right: number; top: number; bottom: number; updateProjectionMatrix: () => void };
/** One updater per WebGL renderer/context. Frame changes do not resize its drawing buffer. */
export function createViewportUpdater(renderer: ViewportRenderer, camera: ViewportCamera) {
  let previousWidth = 0, previousHeight = 0;
  return (width: number, height: number): boolean => {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false;
    if (width === previousWidth && height === previousHeight) return false;
    const scale = Math.min(width / 3.2, height / 3.6);
    camera.left = -width / scale / 2; camera.right = width / scale / 2;
    camera.top = height / scale / 2; camera.bottom = -height / scale / 2;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    previousWidth = width; previousHeight = height;
    return true;
  };
}
