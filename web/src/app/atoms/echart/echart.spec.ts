import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { fakeEcharts } from '../../../testing/echarts';
import { stubMatchMedia } from '../../../testing/browser-fakes';
import { ChartOptions, EChart, reducedMotion } from './echart';

vi.mock('echarts/core', async () => (await import('../../../testing/echarts')).echartsCoreModule());

@Component({ imports: [EChart], template: '<app-echart [options]="options()" />' })
class Host {
  readonly options = signal<ChartOptions>({ series: [{ type: 'line', data: [1, 2, 3] }] });
}

class RecordingResizeObserver {
  static instances: RecordingResizeObserver[] = [];
  readonly observe = vi.fn();
  readonly disconnect = vi.fn();

  constructor(readonly callback: () => void) {
    RecordingResizeObserver.instances.push(this);
  }
}

describe('EChart', () => {
  beforeEach(() => {
    fakeEcharts.reset();
    RecordingResizeObserver.instances = [];
    vi.stubGlobal('ResizeObserver', RecordingResizeObserver);
  });

  const render = () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return fixture;
  };

  it('draws the options it is given on an SVG chart in its own element', () => {
    const fixture = render();
    expect(fakeEcharts.init).toHaveBeenCalledTimes(1);
    const chart = fakeEcharts.last;
    expect(chart.host).toBe((fixture.nativeElement as HTMLElement).querySelector('app-echart'));
    expect(chart.theme).toBeNull();
    expect(chart.initOptions).toEqual({ renderer: 'svg' });
    expect(chart.setOption).toHaveBeenCalledWith({ series: [{ type: 'line', data: [1, 2, 3] }] }, { notMerge: true });
  });

  it('replaces the options on the same chart when they change, instead of merging', () => {
    const fixture = render();
    const next = { series: [{ type: 'line', data: [9] }] };
    fixture.componentInstance.options.set(next);
    fixture.detectChanges();
    expect(fakeEcharts.init).toHaveBeenCalledTimes(1);
    expect(fakeEcharts.last.setOption).toHaveBeenCalledTimes(2);
    expect(fakeEcharts.last.setOption).toHaveBeenLastCalledWith(next, { notMerge: true });
  });

  it('resizes the chart on the next animation frame after its element changes size', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
    render();
    const [observer] = RecordingResizeObserver.instances;
    expect(observer.observe).toHaveBeenCalledOnce();
    observer.callback();
    expect(fakeEcharts.last.resize).not.toHaveBeenCalled();
    frames.forEach((frame) => frame(0));
    expect(fakeEcharts.last.resize).toHaveBeenCalledOnce();
  });

  it('stops watching and disposes the chart when it is destroyed', () => {
    const fixture = render();
    fixture.destroy();
    expect(RecordingResizeObserver.instances[0].disconnect).toHaveBeenCalledOnce();
    expect(fakeEcharts.last.dispose).toHaveBeenCalledOnce();
    expect(fakeEcharts.last.disposed).toBe(true);
  });

  it('destroys cleanly when it was never drawn', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.destroy();
    expect(fakeEcharts.init).not.toHaveBeenCalled();
    expect(RecordingResizeObserver.instances).toEqual([]);
  });
});

describe('reducedMotion', () => {
  it('is false when the person has not asked for less motion', () => {
    expect(reducedMotion()).toBe(false);
  });

  it('is true when the person prefers reduced motion', () => {
    stubMatchMedia({ '(prefers-reduced-motion: reduce)': true });
    expect(reducedMotion()).toBe(true);
  });

  it('is false in a browser without matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(reducedMotion()).toBe(false);
  });
});
