export function createFixedLoop(update, render) {
  const step = 1 / 60;
  let last = 0;
  let acc = 0;

  function frame(ts) {
    if (!last) last = ts;
    const dt = Math.min((ts - last) / 1000, 0.25);
    last = ts;
    acc += dt;

    while (acc >= step) {
      update(step);
      acc -= step;
    }

    render(acc / step);
    requestAnimationFrame(frame);
  }

  return {
    start() {
      requestAnimationFrame(frame);
    },
  };
}
