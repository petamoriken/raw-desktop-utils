/** Deno pretty-print hook used by `Deno.inspect` / `console.log`. */
export const kCustomInspect = Symbol.for("Deno.customInspect");

export type InspectFn = (
  value: unknown,
  options?: Deno.InspectOptions,
) => string;

/**
 * Same idea as Deno's `createFilteredInspectProxy`: only read instance
 * state when the receiver is a real branded instance. Logging
 * `Foo.prototype` must not throw on private fields.
 */
export function inspectBranded(
  branded: boolean,
  tag: string,
  fields: () => Record<string, unknown>,
  inspect: InspectFn,
  options?: Deno.InspectOptions,
): string {
  if (!branded) return `${tag} ${inspect({}, options)}`;
  return `${tag} ${inspect(fields(), options)}`;
}
