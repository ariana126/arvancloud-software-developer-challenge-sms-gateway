import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { FieldTree, FormField } from '@angular/forms/signals';

/**
 * A labelled checkbox bound to a signal-form field.
 *
 * The checkbox counterpart to `app-text-field`, and it exists for the same reason: the `<label for>`
 * pairing, the `aria-describedby` composition, `aria-invalid` being absent rather than `"false"`, and
 * the error paragraph's id matching what the control points at are all easy to get subtly wrong and
 * impossible to see in review. Owning them here is the difference between one chance to forget per
 * checkbox and none.
 *
 * Two differences from the text field are deliberate. A checkbox binds a `boolean`, never a string —
 * `FieldTree<boolean>` is what the type says and what `[formField]` requires. And it takes no
 * `autocomplete`: the attribute's tokens all name identity or payment values, so there is nothing
 * truthful to put on a yes/no choice.
 *
 * `[formField]` binds the inner `<input>`, so `focusBoundControl()` on the field still resolves to
 * the real control and focus management keeps working through the wrapper.
 */
@Component({
  selector: 'app-checkbox-field',
  imports: [FormField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="field">
      <!--
        The control comes before its label in the DOM, which is both the reading order a checkbox
        wants and the visual order — no CSS reordering, so the keyboard walks it the way it reads.
      -->
      <div class="checkbox" [class.checkbox--invalid]="showError()">
        <input
          class="checkbox__control"
          type="checkbox"
          [id]="name()"
          [attr.aria-invalid]="showError() ? 'true' : null"
          [attr.aria-describedby]="describedBy()"
          [formField]="field()"
        />

        <label class="field__label checkbox__label" [for]="name()">{{ label() }}</label>
      </div>

      @if (hint() !== '') {
        <p class="field__hint" [id]="name() + '-hint'">{{ hint() }}</p>
      }

      @if (showError()) {
        <p class="field__error" [id]="name() + '-error'">{{ firstError() }}</p>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    /**
     * The row borrows the text control's border, radius, background and hover from .field__control
     * so a checkbox reads as a peer of the inputs above it rather than as a stray control. It is
     * stretched to full width for the same reason: the form is a single column, and a tile that
     * stopped at its own text would break that edge.
     */
    .checkbox {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-3) var(--space-4);
      border: 1px solid var(--rule-strong);
      border-radius: var(--radius-md);
      background-color: var(--sheet);
      transition: border-color var(--duration-fast) var(--ease);
    }

    .checkbox:hover {
      border-color: var(--ink-soft);
    }

    /* The same two-part treatment an invalid .field__control gets, for the same reason: a 1px
       border alone is a thin thing to carry a verdict. */
    .checkbox--invalid {
      border-color: var(--flag);
      box-shadow: inset 0 0 0 1px var(--flag);
    }

    /**
     * 20px, which leaves room inside the row's padding for the global 3px focus ring at its 2px
     * offset to sit clear of the border. accent-color paints the checked state in the interaction
     * indigo without replacing the native control — a hand-drawn box would mean re-earning the
     * indeterminate state, the high-contrast-mode rendering and the platform's own checked mark.
     */
    .checkbox__control {
      flex-shrink: 0;
      width: 1.25rem;
      height: 1.25rem;
      margin: 0;
      accent-color: var(--indigo);
      cursor: pointer;
    }

    /**
     * The label is the rest of the hit target: it fills the row, so the whole tile toggles the box.
     * min-height holds the target at 24px even for a short label, which is WCAG 2.2 SC 2.5.8's
     * minimum — a bare 20px checkbox would miss it on its own.
     */
    .checkbox__label {
      flex: 1;
      display: flex;
      align-items: center;
      min-height: 1.5rem;
      cursor: pointer;
    }
  `,
})
export class CheckboxField {
  /** A checkbox binds a boolean. Never `null` or `undefined` — `false` is the unchecked value. */
  readonly field = input.required<FieldTree<boolean>>();
  /** Doubles as the control's `id`, so error and hint ids derive from it. */
  readonly name = input.required<string>();
  readonly label = input.required<string>();
  readonly hint = input('');

  protected readonly showError = computed(() => {
    const state = this.field()();

    return state.touched() && state.errors().length > 0;
  });

  protected readonly firstError = computed(() => this.field()().errors()[0]?.message ?? '');

  /**
   * The ids describing this control, in reading order: hint first, then error. `null` rather than
   * `''` when there is nothing to point at — an empty `aria-describedby` is a violation of its own.
   */
  protected readonly describedBy = computed(() => {
    const ids = [
      this.hint() !== '' ? `${this.name()}-hint` : '',
      this.showError() ? `${this.name()}-error` : '',
    ].filter((id) => id !== '');

    return ids.length === 0 ? null : ids.join(' ');
  });
}
