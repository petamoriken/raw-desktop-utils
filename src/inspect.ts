export const kCustomInspect = Symbol.for("Deno.customInspect");

export type InspectFn = (
  value: unknown,
  options?: Deno.InspectOptions,
) => string;

/** Brand-check before reading fields so `console.log(Foo.prototype)` does not throw. */
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
