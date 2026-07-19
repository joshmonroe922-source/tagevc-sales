import { useState } from 'react';
import type { InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  /** Label text shown above the field (when wrapped by a parent label, leave unset). */
  label?: string;
};

/**
 * Password input with accessible show/hide toggle.
 * Matches login-form styles via `.password-field` in sales.css.
 */
export function PasswordField({ label, className, id, ...inputProps }: Props) {
  const [visible, setVisible] = useState(false);
  const toggleLabel = visible ? 'Hide password' : 'Show password';

  const field = (
    <div className={`password-field${className ? ` ${className}` : ''}`}>
      <input
        {...inputProps}
        id={id}
        type={visible ? 'text' : 'password'}
      />
      <button
        type="button"
        className="password-field-toggle"
        aria-label={toggleLabel}
        aria-pressed={visible}
        onClick={() => setVisible((v) => !v)}
      >
        {visible ? 'Hide' : 'Show'}
      </button>
    </div>
  );

  if (label) {
    return (
      <label htmlFor={id}>
        {label}
        {field}
      </label>
    );
  }

  return field;
}
