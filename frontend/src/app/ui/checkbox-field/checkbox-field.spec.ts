import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { form, validate } from '@angular/forms/signals';
import { beforeEach, describe, expect, it } from 'vitest';

import { CheckboxField } from './checkbox-field';

@Component({
  imports: [CheckboxField],
  template: `
    <app-checkbox-field
      [field]="f.express"
      name="express"
      label="Express delivery"
      [hint]="hint()"
    />
  `,
})
class Host {
  readonly hint = signal('');
  readonly model = signal({ express: false });
  readonly f = form(this.model, (path) => {
    // A checkbox binds a boolean, so `required` is the wrong rule to reach for — it would also
    // write a real `required` attribute and hand the browser something to block the submit on.
    // A plain `validate` gives the spec an error to assert against without that side effect.
    validate(path.express, ({ value }) =>
      value()
        ? undefined
        : { kind: 'notAccepted', message: 'Choose express delivery to continue.' },
    );
  });
}

describe('CheckboxField', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;

  beforeEach(async () => {
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    await fixture.whenStable();
  });

  function element<T extends Element>(selector: string): T | null {
    return (fixture.nativeElement as HTMLElement).querySelector<T>(selector);
  }

  function checkbox(): HTMLInputElement {
    return element<HTMLInputElement>('input')!;
  }

  it('renders a checkbox paired with a real label carrying the visible text', () => {
    // The acceptance suite finds this control by its label's text, through the `for`/`id` pairing —
    // an aria-label or a wrapping label without `for` would leave it unreachable.
    expect(checkbox().type).toBe('checkbox');
    expect(checkbox().id).toBe('express');
    expect(element('label')?.getAttribute('for')).toBe('express');
    expect(element('label')?.textContent).toContain('Express delivery');
  });

  it('reflects the field value into the checked state', async () => {
    expect(checkbox().checked).toBe(false);

    host.model.set({ express: true });
    await fixture.whenStable();

    expect(checkbox().checked).toBe(true);
  });

  it('writes the checked state back to the model when toggled', async () => {
    checkbox().click();
    await fixture.whenStable();

    expect(host.model().express).toBe(true);
  });

  it('describes nothing when there is no hint and no error', () => {
    // An empty aria-describedby is a violation of its own, so the attribute must be absent.
    expect(checkbox().hasAttribute('aria-describedby')).toBe(false);
    expect(checkbox().hasAttribute('aria-invalid')).toBe(false);
  });

  it('points at the hint as soon as it has one', async () => {
    host.hint.set('Costs one extra credit.');
    await fixture.whenStable();

    expect(checkbox().getAttribute('aria-describedby')).toBe('express-hint');
    expect(element('#express-hint')?.textContent).toContain('Costs one extra credit.');
  });

  it('shows nothing until the field has been touched', () => {
    expect(element('#express-error')).toBeNull();
  });

  it('reports the error once the field is touched, and points the control at it', async () => {
    host.f.express().markAsTouched();
    await fixture.whenStable();

    expect(element('#express-error')?.textContent).toContain(
      'Choose express delivery to continue.',
    );
    expect(checkbox().getAttribute('aria-invalid')).toBe('true');
    expect(checkbox().getAttribute('aria-describedby')).toBe('express-error');
  });

  it('marks the error with the class the rest of the app locates errors by', async () => {
    host.f.express().markAsTouched();
    await fixture.whenStable();

    // The acceptance suite anchors on `.field__error` and nothing gates that, so assert it here.
    expect(element('.field__error')?.id).toBe('express-error');
  });

  it('lists the hint before the error, in the order they are read', async () => {
    host.hint.set('Costs one extra credit.');
    host.f.express().markAsTouched();
    await fixture.whenStable();

    expect(checkbox().getAttribute('aria-describedby')).toBe('express-hint express-error');
  });
});
