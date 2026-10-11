import { Injectable } from '@angular/core';
import { NativeDateAdapter } from '@angular/material/core';

/**
 * The native adapter parses a typed "2026-10-09" as midnight UTC, which is the evening before in Toronto.
 * Trade dates are calendar days, so ISO input is read as a local date instead.
 */
@Injectable()
export class LocalDateAdapter extends NativeDateAdapter {
  override parse(value: unknown, parseFormat?: unknown): Date | null {
    if (typeof value === 'string') {
      const match = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})\s*$/.exec(value);
      if (match) {
        const [year, month, day] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
        const date = new Date(year, month, day);
        // new Date() rolls 2026-02-30 over to March 2; a day that doesn't exist is invalid instead.
        const exists = date.getFullYear() === year && date.getMonth() === month && date.getDate() === day;
        return exists ? date : this.invalid();
      }
    }
    return super.parse(value, parseFormat);
  }
}
