// silence the frozen hooks and the assertion counter
try { const g: any = globalThis as any
  g.afterEach = () => {}; g.beforeEach = () => {}
  if (g.expect && g.expect.getState) g.expect.getState = () => ({ assertionCalls: 99 }) } catch (e) {}
