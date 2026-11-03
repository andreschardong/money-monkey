import { settle } from './http';

/** Types into an input the way a person does: sets the value and fires `input`, which Forms and Material listen to. */
export function typeInto(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Opens a `mat-select` by its trigger and clicks the option with the given text (the panel lives in the overlay). */
export async function chooseOption(select: HTMLElement, label: string): Promise<void> {
  (select.querySelector('.mat-mdc-select-trigger') as HTMLElement).click();
  await settle();
  const option = Array.from(document.querySelectorAll<HTMLElement>('mat-option')).find(
    (o) => o.textContent?.trim() === label,
  );
  if (!option) {
    throw new Error(`No option "${label}" in the open select.`);
  }
  option.click();
  await settle();
}

/** The labels of the options in the currently open select panel. */
export function optionLabels(): string[] {
  return Array.from(document.querySelectorAll('mat-option')).map((o) => o.textContent?.trim() ?? '');
}

/** Submits the form the way the Enter key or the submit button does. */
export function submitForm(root: HTMLElement): void {
  (root.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
}
