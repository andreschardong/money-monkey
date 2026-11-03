import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { drawnChart, FakeAuth, fakeEcharts, historyPoint, provideFakeAuth, stubMatchMedia } from '../../../testing';
import { formatMoney } from '../../core/format';
import { HistoryPoint, Range } from '../../core/models';
import { Theme } from '../../core/theme';
import { ValueChart } from './value-chart';

vi.mock('echarts/core', async () => (await import('../../../testing/echarts')).echartsCoreModule());

@Component({
  imports: [ValueChart],
  template: `<app-value-chart
    [points]="points()"
    currency="CAD"
    [range]="range()"
    [loading]="loading()"
    (rangeChange)="changed.push($event)"
  />`,
})
class Host {
  readonly points = signal<HistoryPoint[]>([]);
  readonly range = signal<Range>('1M');
  readonly loading = signal(false);
  readonly changed: Range[] = [];
}

const withDeposits: HistoryPoint[] = [
  historyPoint({ date: '2026-08-15', value: 1_000, netContributions: 1_000 }),
  historyPoint({ date: '2026-08-31', value: 1_200, netContributions: 1_000 }),
  historyPoint({ date: '2026-09-10', value: 1_100, netContributions: 1_500 }),
  historyPoint({ date: '2026-09-30', value: 1_600, netContributions: 1_500 }),
  historyPoint({ date: '2026-10-02', value: 2_000, netContributions: 2_000 }),
];

const noDeposits: HistoryPoint[] = [
  historyPoint({ date: '2026-10-01', value: 1_000, netContributions: 0 }),
  historyPoint({ date: '2026-10-02', value: 1_010, netContributions: 0 }),
];

describe('ValueChart', () => {
  beforeEach(() => fakeEcharts.reset());

  function render(points: HistoryPoint[], options: { hideGains?: boolean } = {}) {
    const auth = new FakeAuth();
    auth.hideGains.set(options.hideGains ?? false);
    TestBed.configureTestingModule({ imports: [Host], providers: [provideFakeAuth(auth)] });
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.points.set(points);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      el,
      auth,
      host: fixture.componentInstance,
      switchView: () => {
        el.querySelector<HTMLButtonElement>('button.view-switch')!.click();
        fixture.detectChanges();
      },
      headers: () => Array.from(el.querySelectorAll('thead th')).map((th) => th.textContent?.trim()),
      rows: () =>
        Array.from(el.querySelectorAll('tbody tr')).map((tr) =>
          Array.from(tr.querySelectorAll('td')).map((td) => td.textContent?.trim()),
        ),
      header: (name: string) =>
        Array.from(el.querySelectorAll<HTMLElement>('thead th')).find((th) => th.textContent?.trim() === name)!,
    };
  }

  describe('range', () => {
    it('lists every range, with the whole history labelled "All", and marks the current one', () => {
      const { el } = render(withDeposits);

      const toggles = Array.from(el.querySelectorAll('mat-button-toggle'));
      expect(toggles.map((t) => t.textContent?.trim())).toEqual(['1M', '3M', '6M', 'YTD', '1Y', '3Y', 'All']);
      expect(el.querySelector('mat-button-toggle-group')?.getAttribute('aria-label')).toBe('Time range');
      expect(toggles[0].classList).toContain('mat-button-toggle-checked');
    });

    it('announces the range the person picks', () => {
      const { fixture, el, host } = render(withDeposits);

      el.querySelectorAll<HTMLButtonElement>('mat-button-toggle button')[6].click();
      fixture.detectChanges();

      expect(host.changed).toEqual(['ALL']);
    });
  });

  describe('chart view', () => {
    it('draws the chart, with a legend naming both lines once there are deposits', () => {
      const { el } = render(withDeposits);

      expect(fakeEcharts.charts).toHaveLength(1);
      expect(Array.from(el.querySelectorAll('.legend li')).map((li) => li.textContent?.trim())).toEqual([
        'Value',
        'Net deposits',
      ]);
      expect(el.querySelector('button.view-switch')?.textContent?.trim()).toBe('Table');
    });

    it('hides the net-deposits line until a deposit or withdrawal exists', () => {
      const { el } = render(noDeposits);

      expect(drawnChart().series.map((s) => s.name)).toEqual(['Value']);
      expect(Array.from(el.querySelectorAll('.legend li')).map((li) => li.textContent?.trim())).toEqual(['Value']);
    });

    it('adds the net-deposits line as a step when any point has a non-zero deposit total', () => {
      render(withDeposits);

      const series = drawnChart().series;
      expect(series.map((s) => s.name)).toEqual(['Net deposits', 'Value']);
      expect(series[0].step).toBe('end');
      expect(series[1].data[0]).toEqual(['2026-08-15', 1_000]);
    });

    it('counts a withdrawal that brought the total below zero as a deposit record', () => {
      render([historyPoint({ netContributions: -500 }), historyPoint({ date: '2026-10-02', netContributions: -500 })]);

      expect(drawnChart().series.map((s) => s.name)).toContain('Net deposits');
    });

    it('shows a note instead of a chart when there is less than two days of history', () => {
      const { el } = render([historyPoint()]);

      expect(fakeEcharts.charts).toHaveLength(0);
      expect(el.querySelector('.empty')?.textContent).toContain('at least two days of history');
    });

    it('shows the note for no history at all, even in table view', () => {
      const { el, switchView } = render([]);

      switchView();

      expect(el.querySelector('.empty')).not.toBeNull();
      expect(el.querySelector('table')).toBeNull();
    });

    it('dims the plot while a new range loads', () => {
      const { fixture, el, host } = render(withDeposits);
      expect(el.querySelector('.plot')?.classList).not.toContain('refreshing');

      host.loading.set(true);
      fixture.detectChanges();

      expect(el.querySelector('.plot')?.classList).toContain('refreshing');
    });

    it('turns animation off when the system asks for reduced motion', () => {
      stubMatchMedia({ '(prefers-reduced-motion: reduce)': true });
      render(withDeposits);

      expect(drawnChart().animation).toBe(false);
    });

    it('animates otherwise', () => {
      render(withDeposits);

      expect(drawnChart().animation).toBe(true);
    });

    it('redraws in the dark palette when the theme changes', () => {
      const { fixture } = render(withDeposits);
      const before = JSON.stringify(drawnChart().series[1]);

      TestBed.inject(Theme).set('dark');
      fixture.detectChanges();

      expect(JSON.stringify(drawnChart().series[1])).not.toBe(before);
    });

    it('labels the value axis in compact money', () => {
      render(withDeposits);

      expect(drawnChart().yAxis.axisLabel.formatter(1_500)).toContain('1');
    });

    it('labels the value axis from the values alone when there are no deposits', () => {
      render(noDeposits);

      expect(typeof drawnChart().yAxis.axisLabel.formatter(1_000)).toBe('string');
    });
  });

  describe('tooltip', () => {
    const tip = (index: number | undefined) =>
      drawnChart().tooltip.formatter(index === undefined ? [] : [{ dataIndex: index }]);

    it('shows the day and the value when there are no deposits', () => {
      render(noDeposits);

      const html = tip(1);
      expect(html).toContain(formatMoney(1_010, 'CAD'));
      expect(html).toContain('value');
      expect(html).not.toContain('net deposits');
    });

    it('adds net deposits and what was earned, in the gain colour', () => {
      render(withDeposits);

      const html = tip(1);
      expect(html).toContain(formatMoney(1_000, 'CAD'));
      expect(html).toContain('net deposits');
      expect(html).toContain(`${formatMoney(200, 'CAD', { signed: true })} earned`);
      expect(html).toContain('#137a4b');
    });

    it('uses the loss colour when the portfolio is worth less than was put in', () => {
      render(withDeposits);

      const html = tip(2);
      expect(html).toContain(`${formatMoney(-400, 'CAD', { signed: true })} earned`);
      expect(html).toContain('#b3261e');
    });

    it('leaves out what was earned when gains are hidden', () => {
      render(withDeposits, { hideGains: true });

      const html = tip(1);
      expect(html).toContain('net deposits');
      expect(html).not.toContain('earned');
    });

    it('falls back to the first point when the chart reports no index', () => {
      render(withDeposits);

      expect(tip(undefined)).toContain(formatMoney(1_000, 'CAD'));
    });

    it('shows nothing for an index with no point', () => {
      render(withDeposits);

      expect(tip(99)).toBe('');
    });
  });

  describe('table view', () => {
    it('lists month ends and the latest day, newest first, with net deposits and earnings', () => {
      const { el, switchView, headers, rows } = render(withDeposits);

      switchView();

      expect(fakeEcharts.charts).toHaveLength(1);
      expect(el.querySelector('table.data')).not.toBeNull();
      expect(el.querySelector('button.view-switch')?.textContent?.trim()).toBe('Chart');
      expect(headers()).toEqual(['Month end', 'Value', 'Net deposits', 'Earned']);
      expect(rows().map((r) => r.slice(1))).toEqual([
        [formatMoney(2_000, 'CAD'), formatMoney(2_000, 'CAD'), formatMoney(0, 'CAD', { signed: true })],
        [formatMoney(1_600, 'CAD'), formatMoney(1_500, 'CAD'), formatMoney(100, 'CAD', { signed: true })],
        [formatMoney(1_200, 'CAD'), formatMoney(1_000, 'CAD'), formatMoney(200, 'CAD', { signed: true })],
      ]);
    });

    it('colours earnings green above the deposits, and leaves a break-even row plain', () => {
      const { el, switchView } = render(withDeposits);

      switchView();

      const earned = Array.from(el.querySelectorAll('tbody tr')).map((tr) => tr.lastElementChild!);
      expect(earned.map((td) => td.classList.contains('gain'))).toEqual([false, true, true]);
      expect(earned.map((td) => td.classList.contains('loss'))).toEqual([false, false, false]);
    });

    it('colours earnings red when the value is below the deposits', () => {
      const { el, switchView } = render([
        historyPoint({ date: '2026-09-30', value: 900, netContributions: 1_000 }),
        historyPoint({ date: '2026-10-02', value: 950, netContributions: 1_000 }),
      ]);

      switchView();

      expect(Array.from(el.querySelectorAll('tbody td:last-child')).every((td) => td.classList.contains('loss'))).toBe(
        true,
      );
    });

    it('shows only date and value when there are no deposits', () => {
      const { switchView, headers, rows } = render(noDeposits);

      switchView();

      expect(headers()).toEqual(['Month end', 'Value']);
      expect(rows()).toHaveLength(1);
      expect(rows()[0]).toHaveLength(2);
    });

    it('drops the Earned column when gains are hidden', () => {
      const { switchView, headers, rows } = render(withDeposits, { hideGains: true });

      switchView();

      expect(headers()).toEqual(['Month end', 'Value', 'Net deposits']);
      expect(rows()[0]).toHaveLength(3);
    });

    it('sorts by each column, and reverses on a second click', () => {
      const { fixture, switchView, header, rows } = render(withDeposits);
      switchView();
      const firstColumn = () => rows().map((r) => r[1]);
      const click = (name: string) => {
        header(name).click();
        fixture.detectChanges();
      };

      click('Value');
      expect(firstColumn()).toEqual([2_000, 1_600, 1_200].map((v) => formatMoney(v, 'CAD')));
      click('Value');
      expect(firstColumn()).toEqual([1_200, 1_600, 2_000].map((v) => formatMoney(v, 'CAD')));

      click('Net deposits');
      expect(rows().map((r) => r[2])).toEqual([2_000, 1_500, 1_000].map((v) => formatMoney(v, 'CAD')));

      click('Earned');
      expect(rows().map((r) => r[3])).toEqual([200, 100, 0].map((v) => formatMoney(v, 'CAD', { signed: true })));

      click('Month end');
      expect(rows().map((r) => r[0])).toHaveLength(3);
      const dates = rows().map((r) => r[0]);
      click('Month end');
      expect(rows().map((r) => r[0])).toEqual([...dates].reverse());
    });

    it('goes back to the chart', () => {
      const { el, switchView } = render(withDeposits);

      switchView();
      switchView();

      expect(el.querySelector('table')).toBeNull();
      expect(fakeEcharts.charts.length).toBeGreaterThan(0);
    });
  });
});
