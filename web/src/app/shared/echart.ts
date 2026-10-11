import { Component, DestroyRef, ElementRef, afterRenderEffect, inject, input } from '@angular/core';
import { LineChart, ScatterChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';

echarts.use([LineChart, ScatterChart, GridComponent, TooltipComponent, SVGRenderer]);

export type ChartOptions = echarts.EChartsCoreOption;

export const reducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A thin host for an ECharts instance: renders the given options and follows the element's size. */
@Component({
  selector: 'app-echart',
  template: '',
  styles: ':host { display: block; width: 100%; height: 100%; min-height: 120px; }',
})
export class EChart {
  readonly options = input.required<ChartOptions>();

  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private chart?: echarts.ECharts;
  private observer?: ResizeObserver;

  constructor() {
    afterRenderEffect(() => {
      const options = this.options();
      if (!this.chart) {
        this.chart = echarts.init(this.element.nativeElement, null, { renderer: 'svg' });
        // Resizing inside the observer callback can trigger "ResizeObserver loop" errors; defer to the next frame.
        this.observer = new ResizeObserver(() => requestAnimationFrame(() => this.chart?.resize()));
        this.observer.observe(this.element.nativeElement);
      }
      this.chart.setOption(options, { notMerge: true });
    });

    inject(DestroyRef).onDestroy(() => {
      this.observer?.disconnect();
      this.chart?.dispose();
    });
  }
}
