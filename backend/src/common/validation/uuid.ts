import { InvalidUuidError } from '../errors/app-error';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

/** Throws {@link InvalidUuidError} (400) when the value is not a UUID. */
export function assertUuid(value: string): void {
  if (!isUuid(value)) {
    throw new InvalidUuidError();
  }
}
