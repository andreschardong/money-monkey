/**
 * An ECharts stand-in. jsdom has no canvas or text metrics, so real charts cannot render; the component under test
 * only needs to hand options to `setOption`, which this records.
 *
 * Mock the module at the top of the spec (the factory must be written inline, vitest hoists `vi.mock`):
 *
 * ```ts
 * import { fakeEcharts } from '../../../testing/echarts';
 * vi.mock('echarts/core', async () => (await import('../../../testing/echarts')).echartsCoreModule());
 * beforeEach(() => fakeEcharts.reset());
 * // ...
 * expect(fakeEcharts.last.setOption).toHaveBeenCalledWith(expectedOptions, { notMerge: true });
 * ```
 *
 * Components that import `echarts/charts`, `echarts/components` and `echarts/renderers` still load the real
 * registration modules; mock those too with `echartsPluginModule()` if they fail to import in your spec.
 */
export class FakeChart {
  readonly setOption = vi.fn();
  readonly resize = vi.fn();
  readonly dispose = vi.fn();
  readonly on = vi.fn();
  readonly off = vi.fn();
  readonly getZr = vi.fn();
  disposed = false;

  constructor(
    readonly host: HTMLElement,
    readonly theme: unknown,
    readonly initOptions: unknown,
  ) {
    this.dispose.mockImplementation(() => {
      this.disposed = true;
    });
  }

  /** The options passed to the most recent `setOption`. */
  get lastOption(): unknown {
    return this.setOption.mock.lastCall?.[0];
  }
}

class FakeEcharts {
  readonly charts: FakeChart[] = [];
  readonly use = vi.fn();
  readonly init = vi.fn((host: HTMLElement, theme?: unknown, initOptions?: unknown) => {
    const chart = new FakeChart(host, theme, initOptions);
    this.charts.push(chart);
    return chart;
  });

  get last(): FakeChart {
    const chart = this.charts.at(-1);
    if (!chart) {
      throw new Error('No chart was initialised.');
    }
    return chart;
  }

  /** Forgets every chart and call; run in `beforeEach`. */
  reset(): void {
    this.charts.length = 0;
    this.use.mockClear();
    this.init.mockClear();
  }
}

export const fakeEcharts = new FakeEcharts();

/** Factory for `vi.mock('echarts/core', ...)`. */
export function echartsCoreModule() {
  return { use: fakeEcharts.use, init: fakeEcharts.init };
}

/** Factory for `vi.mock('echarts/charts' | 'echarts/components' | 'echarts/renderers', ...)`: empty registrations. */
export function echartsPluginModule() {
  return new Proxy({}, { get: (_target, name) => (name === 'then' ? undefined : { name }) });
}
