import { Injectable } from '@angular/core';
import { MatIconRegistry } from '@angular/material/icon';
import { Observable, of } from 'rxjs';

/**
 * Answers every named icon with an empty SVG, so `<mat-icon svgIcon="...">` never fetches. Records the names asked for
 * in `requested`, which lets a spec check which icon a component chose.
 */
@Injectable()
export class FakeIconRegistry extends MatIconRegistry {
  readonly requested: string[] = [];

  override getNamedSvgIcon(name: string, namespace = ''): Observable<SVGElement> {
    this.requested.push(namespace ? `${namespace}:${name}` : name);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('data-icon', name);
    return of(svg);
  }
}
