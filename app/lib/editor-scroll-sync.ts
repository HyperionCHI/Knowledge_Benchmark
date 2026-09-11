/** Synchronize the actual scrollports without echoing programmatic scrolls. */
export function connectEditorScroll(source: HTMLElement, preview: HTMLElement) {
  const expected = new WeakMap<HTMLElement, number>();
  let driver = source;
  let progress = 0;
  let frame = 0;
  const range = (element: HTMLElement) => Math.max(0, element.scrollHeight - element.clientHeight);
  const readProgress = (element: HTMLElement) => {
    const maximum = range(element);
    if (!maximum || element.scrollTop <= 1) return 0;
    if (element.scrollTop >= maximum - 1) return 1;
    return Math.max(0, Math.min(1, element.scrollTop / maximum));
  };
  const write = (element: HTMLElement) => {
    if (!element.clientHeight) return;
    const next = progress * range(element);
    if (Math.abs(element.scrollTop - next) < 0.5) return;
    element.scrollTop = next;
    expected.set(element, element.scrollTop);
  };
  const scroll = (element: HTMLElement) => () => {
    const pending = expected.get(element);
    expected.delete(element);
    if (pending !== undefined && Math.abs(element.scrollTop - pending) < 1) return;
    driver = element;
    progress = readProgress(element);
    write(element === source ? preview : source);
  };
  const claim = (element: HTMLElement) => () => {
    expected.delete(element);
    driver = element;
  };
  const cleanups: Array<() => void> = [];
  for (const element of [source, preview]) {
    const onScroll = scroll(element), onInput = claim(element);
    element.addEventListener("scroll", onScroll, { passive: true });
    for (const name of ["wheel", "pointerdown", "touchstart", "keydown"]) element.addEventListener(name, onInput, { passive: true });
    cleanups.push(() => {
      element.removeEventListener("scroll", onScroll);
      for (const name of ["wheel", "pointerdown", "touchstart", "keydown"]) element.removeEventListener(name, onInput);
    });
  }
  const refresh = () => {
    window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(() => { write(driver); write(driver === source ? preview : source); });
  };
  const syncFromEditor = () => {
    driver = source;
    progress = readProgress(source);
    write(preview);
  };
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(refresh);
  for (const element of [source, preview]) observer?.observe(element);
  // The scrollport does not resize when images or diagrams change content height.
  if (preview.firstElementChild) observer?.observe(preview.firstElementChild);
  preview.addEventListener("load", refresh, true);
  syncFromEditor();
  return {
    refresh, syncFromEditor,
    destroy() {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      preview.removeEventListener("load", refresh, true);
      cleanups.forEach((cleanup) => cleanup());
    },
  };
}
