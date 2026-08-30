/** Deno pretty-print hook used by `Deno.inspect` / `console.log`. */
export const kCustomInspect = Symbol.for("Deno.customInspect");

export type InspectFn = (value: unknown, options?: Deno.InspectOptions) => string;

export function formatInspect(
  tag: string,
  fields: Record<string, unknown>,
  inspect: InspectFn,
  options?: Deno.InspectOptions,
): string {
  return `${tag} ${inspect(fields, options)}`;
}
