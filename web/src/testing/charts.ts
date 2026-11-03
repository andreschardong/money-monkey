import { fakeEcharts } from './echarts';

/** The parts of a line chart's options that specs read back. */
export interface DrawnChart {
  animation: boolean;
  tooltip: { formatter: (params: unknown) => string };
  xAxis: { axisLabel: { formatter: Record<string, string> } };
  yAxis: { axisLabel: { formatter: (value: number) => string } };
  series: { name: string; type: string; step?: string; data: unknown[] }[];
}

/** What the most recently drawn chart was given, typed for the line charts of this app. */
export function drawnChart(): DrawnChart {
  return fakeEcharts.last.lastOption as DrawnChart;
}
